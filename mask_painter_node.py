import json
import base64
from io import BytesIO
import numpy as np
import torch
from PIL import Image
import gc

class MaskPainter:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "input_image": ("IMAGE",),  # Image Input
                "mask_data": ("STRING", {
                    "default": "{}",
                    "display": "hidden"
                }),  # Painted Mask Data (hidden)
            },
            "optional": {},
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("output_mask",)
    FUNCTION = "generate_mask"
    CATEGORY = "mmmmmmmmm"
    DESCRIPTION = "Paint Mask on Input Image, with Clear All Function --version 0.0"
    OUTPUT_NODE = True  # Mark As Output Node, in order to Run This Node Only

    def generate_mask(self, input_image, mask_data):
        """Decode Frontend Data, generating ComfyUI Standard MASK"""
        
        # 1. Decode Input Image as Base64 for Frontend to Display
        input_image_np = (input_image[0].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
        input_pil = Image.fromarray(input_image_np)
        buffer = BytesIO()
        input_pil.save(buffer, format="PNG")
        input_b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
        buffer.close()

        # 2. Decode Frontend Painted Mask Data
        try:
            mask_info = json.loads(mask_data)
            width = mask_info.get("width", input_image.shape[2])
            height = mask_info.get("height", input_image.shape[1])
            mask_base64 = mask_info.get("data", "")
        except:
            mask = torch.zeros((1, input_image.shape[1], input_image.shape[2]), dtype=torch.float32)
            # return input image + mask data
            return {"ui": {"input_image": [input_b64]}, "result": (mask,)}

        # 3. Decode Mask to ComfyUI MASK
        if mask_base64:
            try:
                mask_bytes = base64.b64decode(mask_base64)
                mask_img = Image.open(BytesIO(mask_bytes)).convert("L")
                mask_img = mask_img.resize((width, height), Image.Resampling.LANCZOS)
                mask_np = np.array(mask_img).astype(np.float32) / 255.0
                mask = torch.from_numpy(mask_np).unsqueeze(0)
            except:
                mask = torch.zeros((1, height, width), dtype=torch.float32)
        else:
            mask = torch.zeros((1, height, width), dtype=torch.float32)

        # 4. Match Output Size to Input Size
        if mask.shape[1:] != (input_image.shape[1], input_image.shape[2]):
            mask = torch.nn.functional.interpolate(
                mask.unsqueeze(0), 
                size=(input_image.shape[1], input_image.shape[2]), 
                mode="bilinear", 
                align_corners=False
            ).squeeze(0)

        # Garbage Collection
        gc.collect()
        # return input image + mask data
        return {"ui": {"input_image": [input_b64]}, "result": (mask,)}

# Register Node
NODE_CLASS_MAPPINGS = {
    "MaskPainter": MaskPainter
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "MaskPainter": "Mask Painter"
}