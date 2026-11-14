import argparse
import base64
import binascii
import io
import json
import math
import os
import sys
from pathlib import Path

_MAX_IMAGE_BYTES = 20 * 1024 * 1024
_MAX_IMAGE_B64 = 4 * ((_MAX_IMAGE_BYTES + 2) // 3)
_MAX_IMAGE_PIXELS = 40_000_000
_MAX_QR_UPSCALE_PIXELS = 8_000_000
_MAX_REQUEST_BYTES = 64 * 1024 * 1024
_NSFW_SIZE = 384
_GROUPS = {
    "ocr": ("ocr_det.onnx", "ocr_rec.onnx", "ppocrv6_dict.txt"),
    "nsfw": ("marqo-nsfw-384.onnx",),
}


class InferenceError(Exception):
    pass


def _protocol_stdout():
    fd = os.dup(sys.stdout.fileno())
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr
    return os.fdopen(fd, "w", encoding="utf-8", buffering=1, newline="\n")


def _bound_environment(threads):
    value = str(threads)
    for name in (
        "OMP_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "MKL_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
    ):
        os.environ[name] = value


def _nsfw_probability(logits):
    values = [float(value) for value in logits]
    if not values:
        raise InferenceError("NSFW model returned no logits")
    maximum = max(values)
    if not math.isfinite(maximum):
        raise InferenceError("NSFW model returned non-finite logits")
    weights = [math.exp(value - maximum) for value in values]
    total = sum(weights)
    if not math.isfinite(total) or total <= 0:
        raise InferenceError("NSFW softmax failed")
    return weights[0] / total


def _nsfw_tensor(image, numpy, Image):
    width, height = image.size
    if width <= height:
        resized_width = _NSFW_SIZE
        resized_height = int(_NSFW_SIZE * height / width)
    else:
        resized_width = int(_NSFW_SIZE * width / height)
        resized_height = _NSFW_SIZE
    if resized_width * resized_height > _MAX_IMAGE_PIXELS:
        raise InferenceError("NSFW resized image exceeds the pixel limit")
    resized = image.resize(
        (resized_width, resized_height), Image.Resampling.BICUBIC
    )
    left = int(round((resized_width - _NSFW_SIZE) / 2.0))
    top = int(round((resized_height - _NSFW_SIZE) / 2.0))
    cropped = resized.crop((left, top, left + _NSFW_SIZE, top + _NSFW_SIZE))
    tensor = numpy.asarray(cropped, dtype=numpy.float32) / 255.0
    return ((tensor - 0.5) / 0.5).transpose(2, 0, 1)[None, ...]


def _error(message):
    return {"frames": [], "error": message or "unknown error"}


def _format_error(exc):
    message = str(exc).strip()
    if message:
        return f"{type(exc).__name__}: {message}"
    return type(exc).__name__


def _emit(stream, value):
    stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    stream.flush()


def _drain_line(stream):
    while True:
        chunk = stream.readline(65536)
        if not chunk or chunk.endswith(b"\n"):
            return


class _Runtime:
    def __init__(self, threads):
        import cv2
        import numpy
        import onnxruntime
        from PIL import Image
        from rapidocr import RapidOCR

        cv2.setNumThreads(1)
        Image.MAX_IMAGE_PIXELS = _MAX_IMAGE_PIXELS
        self.cv2 = cv2
        self.np = numpy
        self.ort = onnxruntime
        self.Image = Image
        self.RapidOCR = RapidOCR
        self.threads = threads


class Worker:
    def __init__(self, models_dir=None, bundled_dir=None, threads=2):
        self.models_dir = models_dir
        self.bundled_dir = bundled_dir
        cpu_count = os.cpu_count() or 1
        self.threads = max(1, min(int(threads), cpu_count))
        self._runtime_value = None
        self._ocr = None
        self._nsfw = None
        self._qr_detector = None

    def _runtime(self):
        if self._runtime_value is None:
            self._runtime_value = _Runtime(self.threads)
        return self._runtime_value

    def _resolve_model(self, filename, models):
        if filename in models:
            provided = models[filename]
            if not isinstance(provided, str) or not provided:
                raise InferenceError(f"models[{filename!r}] must be a path")
            if not os.path.isabs(provided):
                raise InferenceError(f"models[{filename!r}] must be an absolute path")
            if not os.path.isfile(provided):
                raise InferenceError(f"model file is missing: {provided}")
            return provided
        for directory in (self.models_dir, self.bundled_dir):
            if not directory:
                continue
            candidate = Path(directory) / filename
            if candidate.is_file():
                return str(candidate)
        raise InferenceError(f"model file is missing: {filename}")

    def _ocr_engine(self, models):
        if self._ocr is not None:
            return self._ocr
        det_path = self._resolve_model("ocr_det.onnx", models)
        rec_path = self._resolve_model("ocr_rec.onnx", models)
        dict_path = self._resolve_model("ppocrv6_dict.txt", models)
        runtime = self._runtime()
        params = {
            "Global.use_cls": False,
            "Global.log_level": "error",
            "Det.model_path": det_path,
            "Rec.model_path": rec_path,
            "Rec.rec_keys_path": dict_path,
            "EngineConfig.onnxruntime.intra_op_num_threads": self.threads,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "EngineConfig.onnxruntime.enable_cpu_mem_arena": False,
        }
        engine = runtime.RapidOCR(params=params)
        engine._load_det_model()
        engine._load_rec_model()
        self._ocr = engine
        return self._ocr

    def _nsfw_model(self, models):
        if self._nsfw is not None:
            return self._nsfw
        model_path = self._resolve_model("marqo-nsfw-384.onnx", models)
        runtime = self._runtime()
        options = runtime.ort.SessionOptions()
        options.intra_op_num_threads = self.threads
        options.inter_op_num_threads = 1
        options.execution_mode = runtime.ort.ExecutionMode.ORT_SEQUENTIAL
        options.enable_cpu_mem_arena = False
        session = runtime.ort.InferenceSession(
            model_path,
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self._nsfw = (
            session,
            session.get_inputs()[0].name,
            session.get_outputs()[0].name,
        )
        return self._nsfw

    def _ensure_groups(self, groups, models):
        if "ocr" in groups:
            self._ocr_engine(models)
        if "nsfw" in groups:
            self._nsfw_model(models)

    def _decode_image(self, encoded):
        if not isinstance(encoded, str) or not encoded:
            raise InferenceError("image must be a non-empty base64 string")
        if len(encoded) > _MAX_IMAGE_B64:
            raise InferenceError("image exceeds the encoded size limit")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise InferenceError("invalid base64 image") from exc
        if not raw:
            raise InferenceError("image is empty")
        if len(raw) > _MAX_IMAGE_BYTES:
            raise InferenceError("image exceeds the decoded size limit")
        runtime = self._runtime()
        try:
            with runtime.Image.open(io.BytesIO(raw)) as source:
                if source.width < 1 or source.height < 1:
                    raise InferenceError("image has empty dimensions")
                if source.width * source.height > _MAX_IMAGE_PIXELS:
                    raise InferenceError("image dimensions exceed the pixel limit")
                source.load()
                return source.convert("RGB")
        except InferenceError:
            raise
        except Exception as exc:
            raise InferenceError(f"invalid image: {exc}") from exc

    def _ocr_text(self, image, engine):
        runtime = self._runtime()
        array = runtime.np.asarray(image)
        bgr = runtime.np.ascontiguousarray(array[:, :, ::-1])
        result = engine(bgr)
        texts = getattr(result, "txts", None)
        if not texts:
            return ""
        return "\n".join(str(text) for text in texts if str(text).strip())

    def _nsfw_score(self, image, model):
        runtime = self._runtime()
        tensor = _nsfw_tensor(image, runtime.np, runtime.Image)
        session, input_name, output_name = model
        logits = session.run([output_name], {input_name: tensor})[0]
        row = runtime.np.asarray(logits).reshape(logits.shape[0], -1)[0]
        return float(_nsfw_probability(row.tolist()))

    def _has_qr(self, image):
        width, height = image.size
        short_edge = min(width, height)
        if short_edge < 512 and (
            512 * 512 * max(width, height) > _MAX_QR_UPSCALE_PIXELS * short_edge
        ):
            raise InferenceError("QR resized image exceeds the pixel limit")
        runtime = self._runtime()
        if self._qr_detector is None:
            self._qr_detector = runtime.cv2.QRCodeDetector()
        array = runtime.np.asarray(image)
        bgr = runtime.np.ascontiguousarray(array[:, :, ::-1])
        try:
            found, points = self._qr_detector.detectMulti(bgr)
        except Exception:
            try:
                points = self._qr_detector.detect(bgr)[1]
            except Exception as exc:
                raise InferenceError(f"QR detection failed: {exc}") from exc
            return points is not None and len(points) > 0
        return bool(found and points is not None and len(points))

    def process(self, request):
        if not isinstance(request, dict):
            raise InferenceError("request must be a JSON object")
        images = request.get("images")
        if not isinstance(images, list):
            raise InferenceError("images must be an array")
        ocr = request.get("ocr", False)
        nsfw = request.get("nsfw", False)
        if not isinstance(ocr, bool):
            raise InferenceError("ocr must be a boolean")
        if not isinstance(nsfw, bool):
            raise InferenceError("nsfw must be a boolean")
        models = request.get("models", {})
        if models is None:
            models = {}
        if not isinstance(models, dict):
            raise InferenceError("models must be an object")

        groups = set()
        if ocr:
            groups.add("ocr")
        if nsfw:
            groups.add("nsfw")
        self._ensure_groups(groups, models)
        if not images:
            return {"frames": [], "error": ""}

        ocr_engine = self._ocr if ocr else None
        nsfw_model = self._nsfw if nsfw else None
        frames = []
        for index, encoded in enumerate(images):
            try:
                image = self._decode_image(encoded)
                text = self._ocr_text(image, ocr_engine) if ocr else ""
                score = self._nsfw_score(image, nsfw_model) if nsfw else 0.0
            except Exception as exc:
                return {
                    "frames": frames,
                    "error": f"Frame {index}: {_format_error(exc)}",
                }
            try:
                qr = self._has_qr(image)
            except Exception as exc:
                frames.append({"text": text, "nsfw": score, "qr": False})
                return {
                    "frames": frames,
                    "error": f"Frame {index}: {_format_error(exc)}",
                }
            frames.append({"text": text, "nsfw": score, "qr": qr})
        return {"frames": frames, "error": ""}


def _parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", default=None)
    parser.add_argument("--bundled-dir", default=None)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args(argv)
    if args.threads < 1:
        parser.error("--threads must be at least 1")
    return args


def main(argv=None):
    protocol = _protocol_stdout()
    try:
        args = _parse_args(argv)
        _bound_environment(args.threads)
        worker = Worker(args.models_dir, args.bundled_dir, args.threads)
    except SystemExit:
        raise
    except Exception as exc:
        _emit(protocol, _error(_format_error(exc)))
        return 1

    stream = sys.stdin.buffer
    while True:
        line = stream.readline(_MAX_REQUEST_BYTES + 1)
        if not line:
            return 0
        if len(line) > _MAX_REQUEST_BYTES:
            if not line.endswith(b"\n"):
                _drain_line(stream)
            _emit(protocol, _error("request exceeds the size limit"))
            continue
        if not line.strip():
            continue
        try:
            request = json.loads(line.decode("utf-8"))
        except Exception as exc:
            _emit(protocol, _error(_format_error(exc)))
            continue
        try:
            response = worker.process(request)
        except Exception as exc:
            response = _error(_format_error(exc))
        _emit(protocol, response)


if __name__ == "__main__":
    raise SystemExit(main())
