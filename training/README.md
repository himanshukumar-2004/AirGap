# Training the custom privacy detector

## Goal

Train a tiny object detector on the nine privacy classes. Treat this model as a **risk signal**, not a privacy authorization mechanism.

## Recommended dataset

Use your own curated screenshots/photos with consent and synthetic examples. Do not collect real personal documents for training unless you have a lawful, documented basis.

The dataset layout is:

```text
dataset/
  images/train/
  images/val/
  labels/train/
  labels/val/
  classes.txt
```

YOLO label format:

```text
<class_id> <x_center> <y_center> <width> <height>
```

All coordinates are normalized to 0..1.

## Classes

```text
0 face
1 id_card
2 passport
3 credit_card
4 license_plate
5 qr_code
6 signature
7 medical_document
8 medical_image
```

## YOLOX nano training

YOLOX is a good prototype choice because the upstream project is Apache-2.0 and supports ONNX deployment. The v2 browser adapter is written for the standard YOLOX ONNX output.

Install in a separate training environment:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
pip install torch torchvision onnx onnxruntime opencv-python
# clone YOLOX and install it following its README
```

For an NVIDIA GPU, install the matching CUDA-enabled PyTorch wheel from the official PyTorch selector before installing YOLOX.

Start from a YOLOX-nano checkpoint and fine-tune. Use 640 input size. Evaluate per-class precision/recall, not just mAP.

Export to ONNX and validate with ONNX Runtime before putting the file in the extension:

```powershell
python tools/export_onnx.py -n yolox-nano -c path\to\best_ckpt.pth -o best.onnx
```

The exact export command depends on the YOLOX checkout and experiment file you use; validate the output shape with ONNX Runtime.

## Medical-image class

Do not expect one class to solve all medical imaging. Include diverse examples: X-ray, CT/MRI screenshot, ultrasound, pathology, ECG image, radiology report page. The purpose of this class is **risk triage**, not diagnosis.

## Validation targets

For the SIH score, optimize:

- high recall for `medical_document` and `medical_image`
- high recall for `id_card`, `passport`, `credit_card`, `license_plate`, `qr_code`, `signature`
- reasonable precision so the Privacy Check warning is not noisy
- low latency on the actual Windows laptop used for judging

Track a confusion matrix and a separate false-negative test set.
