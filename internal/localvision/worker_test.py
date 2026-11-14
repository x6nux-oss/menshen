import base64
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import worker

MODEL_DIR = os.environ.get("MENSHEN_LOCAL_VISION_TEST_MODELS") or os.environ.get(
    "MENSHEN_LOCAL_MODELS_TEST_DIR"
)
WORKER_SOURCE = (HERE / "worker.py").read_text(encoding="utf-8")
MODEL_FILES = (
    "ocr_det.onnx",
    "ocr_rec.onnx",
    "ppocrv6_dict.txt",
    "marqo-nsfw-384.onnx",
)


class ProbabilityTest(unittest.TestCase):
    def test_softmax_label_order(self):
        self.assertAlmostEqual(worker._nsfw_probability([0, 0]), 0.5)
        self.assertGreater(worker._nsfw_probability([2, 0]), 0.8)
        self.assertLess(worker._nsfw_probability([0, 2]), 0.2)
        self.assertEqual(worker._nsfw_probability([1000, 0]), 1.0)
        self.assertEqual(worker._nsfw_probability([0, 1000]), 0.0)

    def test_softmax_rejects_bad_logits(self):
        with self.assertRaises(worker.InferenceError):
            worker._nsfw_probability([])
        with self.assertRaises(worker.InferenceError):
            worker._nsfw_probability([float("nan"), 0])


class ModelResolutionTest(unittest.TestCase):
    def test_thread_count_is_bounded(self):
        instance = worker.Worker(threads=10**6)
        self.assertLessEqual(instance.threads, os.cpu_count() or 1)
        self.assertGreaterEqual(instance.threads, 1)

    def test_request_paths_win_over_directories(self):
        with tempfile.TemporaryDirectory() as root:
            models_dir = Path(root) / "models"
            bundled_dir = Path(root) / "bundled"
            models_dir.mkdir()
            bundled_dir.mkdir()
            for name in MODEL_FILES:
                (models_dir / name).write_bytes(b"downloaded")
                (bundled_dir / name).write_bytes(b"bundled")
            preferred = Path(root) / "preferred.onnx"
            preferred.write_bytes(b"preferred")
            instance = worker.Worker(models_dir, bundled_dir, 2)
            self.assertEqual(
                instance._resolve_model("ocr_det.onnx", {"ocr_det.onnx": str(preferred)}),
                str(preferred),
            )

    def test_missing_key_falls_back_in_order(self):
        with tempfile.TemporaryDirectory() as root:
            models_dir = Path(root) / "models"
            bundled_dir = Path(root) / "bundled"
            models_dir.mkdir()
            bundled_dir.mkdir()
            (bundled_dir / "ocr_rec.onnx").write_bytes(b"bundled")
            instance = worker.Worker(models_dir, bundled_dir, 2)
            self.assertEqual(
                instance._resolve_model("ocr_rec.onnx", {}),
                str(bundled_dir / "ocr_rec.onnx"),
            )
            (models_dir / "ocr_rec.onnx").write_bytes(b"downloaded")
            self.assertEqual(
                instance._resolve_model("ocr_rec.onnx", {}),
                str(models_dir / "ocr_rec.onnx"),
            )

    def test_bad_request_path_does_not_fall_back(self):
        with tempfile.TemporaryDirectory() as root:
            models_dir = Path(root) / "models"
            models_dir.mkdir()
            (models_dir / "ocr_det.onnx").write_bytes(b"downloaded")
            instance = worker.Worker(models_dir, models_dir, 2)
            with self.assertRaises(worker.InferenceError):
                instance._resolve_model(
                    "ocr_det.onnx", {"ocr_det.onnx": str(Path(root) / "missing.onnx")}
                )
            with self.assertRaises(worker.InferenceError):
                instance._resolve_model(
                    "ocr_det.onnx", {"ocr_det.onnx": "relative.onnx"}
                )


class PreprocessTest(unittest.TestCase):
    def test_extreme_aspect_ratio_is_rejected_before_resize(self):
        from PIL import Image

        for size in ((1, 65535), (65535, 1)):
            with self.subTest(size=size):
                image = Image.new("RGB", size)
                with patch.object(
                    image, "resize", side_effect=AssertionError("oversized allocation")
                ):
                    with self.assertRaisesRegex(worker.InferenceError, "pixel limit"):
                        worker._nsfw_tensor(image, None, Image)

    def test_non_square_nsfw_pipeline_matches_torchvision(self):
        from PIL import Image
        import numpy

        pixels = numpy.arange(501 * 300 * 3, dtype=numpy.uint8).reshape(300, 501, 3)
        image = Image.fromarray(pixels)
        tensor = worker._nsfw_tensor(image, numpy, Image)

        resized_width = int(384 * 501 / 300)
        self.assertEqual(resized_width, 641)
        resized = image.resize(
            (resized_width, 384), Image.Resampling.BICUBIC
        )
        left = int(round((resized_width - 384) / 2.0))
        self.assertEqual(left, 128)
        expected = resized.crop((left, 0, left + 384, 384))
        expected_array = numpy.asarray(expected, dtype=numpy.float32) / 255.0
        expected_array = ((expected_array - 0.5) / 0.5).transpose(2, 0, 1)[None, ...]
        self.assertEqual(tensor.shape, (1, 3, 384, 384))
        numpy.testing.assert_array_equal(tensor, expected_array)

    def test_portrait_nsfw_pipeline_centers_on_long_edge(self):
        from PIL import Image
        import numpy

        pixels = numpy.arange(300 * 501 * 3, dtype=numpy.uint8).reshape(501, 300, 3)
        image = Image.fromarray(pixels)
        tensor = worker._nsfw_tensor(image, numpy, Image)

        resized_height = int(384 * 501 / 300)
        self.assertEqual(resized_height, 641)
        resized = image.resize(
            (384, resized_height), Image.Resampling.BICUBIC
        )
        top = int(round((resized_height - 384) / 2.0))
        self.assertEqual(top, 128)
        expected = resized.crop((0, top, 384, top + 384))
        expected_array = numpy.asarray(expected, dtype=numpy.float32) / 255.0
        expected_array = ((expected_array - 0.5) / 0.5).transpose(2, 0, 1)[None, ...]
        numpy.testing.assert_array_equal(tensor, expected_array)


class QRDetectionTest(unittest.TestCase):
    def test_extreme_aspect_ratio_is_rejected_before_qr_allocation(self):
        from PIL import Image

        instance = worker.Worker(threads=1)
        for size in ((24, 65535), (65535, 24)):
            with self.subTest(size=size):
                with patch.object(
                    instance, "_runtime", side_effect=AssertionError("QR allocation attempted")
                ):
                    with self.assertRaisesRegex(worker.InferenceError, "pixel limit"):
                        instance._has_qr(Image.new("RGB", size))

    def _instance(self, detector):
        import numpy

        instance = worker.Worker(threads=1)
        instance._runtime_value = SimpleNamespace(
            np=numpy,
            cv2=SimpleNamespace(QRCodeDetector=lambda: detector),
        )
        instance._qr_detector = detector
        return instance

    def test_normal_false_is_false(self):
        from PIL import Image

        class Detector:
            def detectMulti(self, image):
                return False, None

            def detect(self, image):
                raise AssertionError("detect should not be called")

        instance = self._instance(Detector())
        self.assertFalse(instance._has_qr(Image.new("RGB", (64, 64), "white")))

    def test_fallback_false_is_false(self):
        from PIL import Image

        class Detector:
            def detectMulti(self, image):
                raise RuntimeError("multi unavailable")

            def detect(self, image):
                return None, None, None

        instance = self._instance(Detector())
        self.assertFalse(instance._has_qr(Image.new("RGB", (64, 64), "white")))

    def test_both_detectors_failing_raises(self):
        from PIL import Image

        class Detector:
            def detectMulti(self, image):
                raise RuntimeError("multi failed")

            def detect(self, image):
                raise RuntimeError("single failed")

        instance = self._instance(Detector())
        with self.assertRaises(worker.InferenceError) as context:
            instance._has_qr(Image.new("RGB", (64, 64), "white"))
        self.assertIn("QR detection failed", str(context.exception))


class PartialFrameTest(unittest.TestCase):
    class FakeWorker(worker.Worker):
        def __init__(self, scores=None, qr_error=False):
            super().__init__(threads=1)
            self.scores = scores or {}
            self.qr_error = qr_error

        def _ensure_groups(self, groups, models):
            return None

        def _decode_image(self, encoded):
            if encoded == "bad":
                raise worker.InferenceError("bad image")
            return encoded

        def _ocr_text(self, image, engine):
            return f"text-{image}"

        def _nsfw_score(self, image, model):
            return self.scores[str(image)]

        def _has_qr(self, image):
            if self.qr_error:
                raise worker.InferenceError("qr failed")
            return False

    def test_bad_third_frame_preserves_completed_prefix(self):
        instance = self.FakeWorker({"first": 0.97, "second": 0.51})
        response = instance.process(
            {"images": ["first", "second", "bad"], "ocr": False, "nsfw": True}
        )
        self.assertEqual(len(response["frames"]), 2)
        self.assertEqual(response["frames"][0]["nsfw"], 0.97)
        self.assertEqual(response["frames"][1]["nsfw"], 0.51)
        self.assertTrue(response["error"].startswith("Frame 2:"))

    def test_qr_failure_preserves_current_text_and_score(self):
        instance = self.FakeWorker({"first": 0.88}, qr_error=True)
        response = instance.process(
            {"images": ["first"], "ocr": True, "nsfw": True}
        )
        self.assertEqual(
            response["frames"],
            [{"text": "text-first", "nsfw": 0.88, "qr": False}],
        )
        self.assertTrue(response["error"].startswith("Frame 0:"))


class RequestValidationTest(unittest.TestCase):
    def setUp(self):
        self.instance = worker.Worker(threads=1)

    def test_empty_request_is_valid_warmup(self):
        response = self.instance.process(
            {"images": [], "ocr": False, "nsfw": False}
        )
        self.assertEqual(response, {"frames": [], "error": ""})

    def test_malformed_requests_fail(self):
        bad_requests = (
            [],
            {"images": "not-an-array"},
            {"images": [], "ocr": "yes"},
            {"images": [], "nsfw": 1},
            {"images": [], "models": []},
            {"images": [], "ocr": True, "models": {"ocr_det.onnx": 3}},
            {"images": [], "ocr": True, "models": {"ocr_det.onnx": None}},
        )
        for request in bad_requests:
            with self.subTest(request=request):
                with self.assertRaises(worker.InferenceError):
                    self.instance.process(request)

    def test_malformed_and_huge_images_return_partial_error(self):
        for encoded in (
            "",
            "not base64!!",
            "A" * (worker._MAX_IMAGE_B64 + 1),
        ):
            with self.subTest(length=len(encoded)):
                response = self.instance.process(
                    {"images": [encoded], "ocr": False, "nsfw": False}
                )
                self.assertEqual(response["frames"], [])
                self.assertTrue(response["error"].startswith("Frame 0:"))

    def test_missing_models_fail_without_download(self):
        with tempfile.TemporaryDirectory() as root:
            instance = worker.Worker(root, root, 1)
            with self.assertRaises(worker.InferenceError) as context:
                instance.process({"images": [], "ocr": True, "nsfw": False})
            self.assertIn("ocr_det.onnx", str(context.exception))


@contextlib.contextmanager
def running_worker(models_dir):
    process = subprocess.Popen(
        [
            sys.executable,
            "-u",
            "-c",
            WORKER_SOURCE,
            "--models-dir",
            str(models_dir),
            "--bundled-dir",
            str(models_dir),
            "--threads",
            "2",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    try:
        yield process
    finally:
        if process.poll() is None:
            process.stdin.close()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        for stream in (process.stdin, process.stdout, process.stderr):
            try:
                stream.close()
            except Exception:
                pass


def send(process, request):
    process.stdin.write(json.dumps(request) + "\n")
    process.stdin.flush()
    line = process.stdout.readline()
    if not line:
        raise AssertionError(process.stderr.read())
    return json.loads(line)


def png_base64(image):
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


class MainProtocolTest(unittest.TestCase):
    def test_request_and_load_failures_return_empty_frames(self):
        with tempfile.TemporaryDirectory() as root:
            with running_worker(root) as process:
                for request in (
                    {"images": "not-an-array", "ocr": True, "nsfw": False},
                    {"images": [], "ocr": True, "nsfw": False},
                ):
                    response = send(process, request)
                    self.assertEqual(response["frames"], [])
                    self.assertTrue(response["error"])


@unittest.skipUnless(
    MODEL_DIR and all((Path(MODEL_DIR) / name).is_file() for name in MODEL_FILES),
    "set MENSHEN_LOCAL_MODELS_TEST_DIR to a directory containing real pinned models",
)
class RealInferenceTest(unittest.TestCase):
    def test_ocr_nsfw_qr_and_errors(self):
        from PIL import Image, ImageDraw
        import cv2
        import numpy

        text_image = Image.new("RGB", (640, 200), "white")
        draw = ImageDraw.Draw(text_image)
        draw.text((20, 70), "Hello offline OCR 12345", fill="black")

        encoder = cv2.QRCodeEncoder_create()
        matrix = encoder.encode("menshen offline qr")
        matrix = numpy.kron(matrix, numpy.ones((8, 8), dtype=numpy.uint8))
        matrix = numpy.where(matrix > 0, 255, 0).astype(numpy.uint8)
        matrix = cv2.copyMakeBorder(
            matrix, 32, 32, 32, 32, cv2.BORDER_CONSTANT, value=255
        )
        qr_image = Image.fromarray(matrix).convert("RGB")

        damaged = matrix.copy()
        crop_width = int(damaged.shape[1] * 0.2)
        crop_height = int(damaged.shape[0] * 0.2)
        center_y = damaged.shape[0] // 2
        center_x = damaged.shape[1] // 2
        damaged[
            center_y - crop_height // 2 : center_y + crop_height // 2,
            center_x - crop_width // 2 : center_x + crop_width // 2,
        ] = 255
        damaged_qr_image = Image.fromarray(damaged).convert("RGB")

        models = {name: str(Path(MODEL_DIR) / name) for name in MODEL_FILES}
        with running_worker(MODEL_DIR) as process:
            warmup = send(
                process, {"images": [], "ocr": True, "nsfw": True, "models": models}
            )
            self.assertEqual(warmup, {"frames": [], "error": ""})

            result = send(
                process,
                {
                    "images": [png_base64(text_image), png_base64(qr_image)],
                    "ocr": True,
                    "nsfw": True,
                    "models": models,
                },
            )
            self.assertEqual(result["error"], "")
            self.assertEqual(len(result["frames"]), 2)
            text_frame, qr_frame = result["frames"]
            self.assertIn("Hello", text_frame["text"])
            self.assertFalse(text_frame["qr"])
            self.assertGreaterEqual(text_frame["nsfw"], 0.0)
            self.assertLess(text_frame["nsfw"], 0.5)
            self.assertTrue(qr_frame["qr"])
            self.assertGreaterEqual(qr_frame["nsfw"], 0.0)
            self.assertLessEqual(qr_frame["nsfw"], 1.0)

            damaged_result = send(
                process,
                {
                    "images": [png_base64(damaged_qr_image)],
                    "ocr": False,
                    "nsfw": False,
                    "models": models,
                },
            )
            self.assertEqual(damaged_result["error"], "")
            self.assertTrue(damaged_result["frames"][0]["qr"])

            malformed = send(
                process,
                {
                    "images": ["not base64!!"],
                    "ocr": True,
                    "nsfw": True,
                    "models": models,
                },
            )
            self.assertEqual(malformed["frames"], [])
            self.assertTrue(malformed["error"])

            process.stdin.write("{bad json}\n")
            process.stdin.flush()
            bad_json = json.loads(process.stdout.readline())
            self.assertEqual(bad_json["frames"], [])
            self.assertTrue(bad_json["error"])


if __name__ == "__main__":
    unittest.main()
