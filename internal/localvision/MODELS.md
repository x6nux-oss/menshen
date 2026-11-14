# Local vision model provenance

All model assets are pinned by URL, byte size and SHA-256 in `models.json`.
The worker never downloads models.

| Manifest file | Source | License |
| --- | --- | --- |
| `ocr_det.onnx` | [PaddlePaddle/PP-OCRv6_small_det_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx), commit `28fe5895c24fd108c19eb3e8479f4ab385fbfc62` | Apache-2.0 |
| `ocr_rec.onnx` | [PaddlePaddle/PP-OCRv6_small_rec_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx), commit `b8f84f0b80c529de40b4fbb3544b84fa7233a513` | Apache-2.0 |
| `ppocrv6_dict.txt` | [RapidAI/RapidOCR](https://www.modelscope.cn/models/RapidAI/RapidOCR), commit `7d0781614ca1a83d5ad9603f713acb2e74855d72`, release `v3.10.0` | Apache-2.0 |
| `marqo-nsfw-384.onnx` | [ICIJ/nsfw-image-detection-384-onnx](https://huggingface.co/ICIJ/nsfw-image-detection-384-onnx), commit `4f63fac119fb24a9d98393e57549b1427530ca52`; ONNX trace of [Marqo/nsfw-image-detection-384](https://huggingface.co/marqo/nsfw-image-detection-384), source revision `0c26ec22111b83f106d72a55f611ec35962bcb65` | Apache-2.0 |

The NSFW model is evaluated with RGB input, 384x384 bicubic resize and center
crop, mean `[0.5, 0.5, 0.5]`, standard deviation `[0.5, 0.5, 0.5]`. Its official
label order is `["NSFW", "SFW"]`; the worker reports the softmax probability of
index 0.

Install runtime dependencies with:

```sh
python -m pip install -r internal/localvision/requirements.txt
```
