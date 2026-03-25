import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

console.log("[MaskPainter] Prototype --version0.0");

// Function Hide Widget
function hideWidgetForGood(node, widget, suffix = '') {
    if (!widget) return;
    widget.origType = widget.type;
    widget.origComputeSize = widget.computeSize;
    widget.origSerializeValue = widget.serializeValue;
    widget.computeSize = () => [0, -4];
    widget.type = "converted-widget" + suffix;
    widget.hidden = true;
    if (widget.element) {
        widget.element.style.display = "none";
        widget.element.style.visibility = "hidden";
    }
    if (widget.linkedWidgets) {
        for (const w of widget.linkedWidgets) {
            hideWidgetForGood(node, w, ':' + widget.name);
        }
    }
}

// Register Node at Frontend
app.registerExtension({
    name: "Comfy.MaskPainter",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "MaskPainter") {
            console.log("[MaskPainter] Register Node at Frontend");
            const onNodeCreated = nodeType.prototype.onNodeCreated;

            nodeType.prototype.onNodeCreated = function () {
                const result = onNodeCreated?.apply(this, arguments);

                // 1. Create Canvas and infoBar Container
                const container = document.createElement("div");
                container.style.cssText = "position: relative; width: 100%; background: #222; overflow: hidden; box-sizing: border-box; margin: 0; padding: 0; display: flex; align-items: center; justify-content: center;";

                // Create infoBar
                const infoBar = document.createElement("div");
                infoBar.style.cssText = "position: absolute; top: 5px; left: 5px; right: 5px; z-index: 10; display: flex; justify-content: space-between; align-items: center;";
                container.appendChild(infoBar);

                // Brush Size (1-999px)
                const brushSizeContainer = document.createElement("div");
                brushSizeContainer.style.cssText = "padding: 5px 10px; background: rgba(0,0,0,0.7); color: #fff; border-radius: 3px; font-size: 12px; font-family: monospace; display: flex; align-items: center; gap: 8px;";
                brushSizeContainer.innerHTML = `BrushSize: <input type="number" value="10" min="1" max="999" style="width: 40px; padding: 2px; background: #444; color: #fff; border: 1px solid #666; border-radius: 2px;">px`;
                infoBar.appendChild(brushSizeContainer);
                const brushSizeInput = brushSizeContainer.querySelector("input");

                // Clear All Button
                const clearButton = document.createElement("button");
                clearButton.textContent = "Clear All";
                clearButton.style.cssText = "padding: 5px 10px; background: #d44; color: #fff; border: 1px solid #a22; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;";
                clearButton.onmouseover = () => clearButton.style.background = "#e55";
                clearButton.onmouseout = () => clearButton.style.background = "#d44";
                infoBar.appendChild(clearButton);

                // Create Display Canvas
                const canvas = document.createElement("canvas");
                canvas.width = 400;
                canvas.height = 300;
                canvas.style.cssText = "display: block; max-width: 100%; max-height: 100%; object-fit: contain; cursor: crosshair; margin: 0 auto;";
                container.appendChild(canvas);
                const ctx = canvas.getContext("2d");

                // Save Painted Mask (do not function well somehow)
                const maskCanvas = document.createElement("canvas");
                maskCanvas.width = canvas.width;
                maskCanvas.height = canvas.height;
                const maskCtx = maskCanvas.getContext("2d");
                maskCtx.fillStyle = "#000";
                maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

                // 2. Save Node Current Condition
                this.maskPainter = {
                    canvas, ctx, maskCanvas, maskCtx, container,
                    image: null,
                    isDrawing: false,
                    brushSize: 10,
                    brushSizeInput,
                    clearButton,
                    lastX: 0,
                    lastY: 0 // record last painting location
                };

                // 3. Add DOM Widget to Node
                const widget = this.addDOMWidget("mask_canvas", "customCanvas", container);
                this.maskPainter.domWidget = widget;
                this.maskPainter.widgetHeight = 300;
                widget.computeSize = (width) => [width, this.maskPainter.widgetHeight];

                // 4. Hide mask_data Widget
                const maskDataWidget = this.widgets.find(w => w.name === "mask_data");
                if (maskDataWidget) {
                    maskDataWidget.value = maskDataWidget.value || "{}";
                    hideWidgetForGood(this, maskDataWidget);
                    this._hiddenWidgets = { mask_data: maskDataWidget };
                }

                // Still about Widget Painting
                const originalDrawForeground = this.onDrawForeground;
                this.onDrawForeground = function(ctx) {
                    const hiddenWidgets = this.widgets.filter(w => w.type?.includes("converted-widget"));
                    const originalTypes = hiddenWidgets.map(w => w.type);
                    hiddenWidgets.forEach(w => w.type = null);
                    if (originalDrawForeground) originalDrawForeground.apply(this, arguments);
                    hiddenWidgets.forEach((w, i) => w.type = originalTypes[i]);
                };

                // 5. EventListenser
                // Change Brush Size（Max 50px）
                brushSizeInput.addEventListener("input", (e) => {
                    this.maskPainter.brushSize = Math.max(1, Math.min(999, parseInt(e.target.value) || 10));
                });

                // Clear All Button
                clearButton.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const { maskCtx, maskCanvas } = this.maskPainter;
                    maskCtx.fillStyle = "#000";
                    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
                    this.updateMaskData();
                    this.redrawCanvas();
                });

                // Get Canvas' Location (correct scale)
                const getCanvasPos = (e, canvas) => {
                    const rect = canvas.getBoundingClientRect();
                    const scaleX = canvas.width / rect.width;
                    const scaleY = canvas.height / rect.height;
                    return {
                        x: (e.clientX - rect.left) * scaleX,
                        y: (e.clientY - rect.top) * scaleY
                    };
                };

                // Painting: Mouse Down
                canvas.addEventListener("mousedown", (e) => {
                    if (e.button !== 0 || !this.maskPainter.image) return;
                    this.maskPainter.isDrawing = true;
                    const pos = getCanvasPos(e, canvas);
                    this.maskPainter.lastX = pos.x;
                    this.maskPainter.lastY = pos.y;
                });

                // Painting: Mouse Move
                canvas.addEventListener("mousemove", (e) => {
                    if (!this.maskPainter.isDrawing || !this.maskPainter.image) return;
                    const pos = getCanvasPos(e, canvas);
                    this.drawLine(this.maskPainter.lastX, this.maskPainter.lastY, pos.x, pos.y);
                    this.maskPainter.lastX = pos.x;
                    this.maskPainter.lastY = pos.y;
                });

                // Painting: Mouse up
                ["mouseup", "mouseleave"].forEach(event => {
                    canvas.addEventListener(event, () => {
                        this.maskPainter.isDrawing = false;
                    });
                });

                // Prevent Right Mouse Click
                canvas.addEventListener("contextmenu", (e) => e.preventDefault());

                // 6. Receive and Load Backend Input Image
                this.onExecuted = (message) => {
                    if (message.input_image && message.input_image[0]) {
                        const img = new Image();
                        img.onload = () => {
                            const { canvas, maskCanvas } = this.maskPainter;
                            canvas.width = img.width;
                            canvas.height = img.height;
                            maskCanvas.width = img.width;
                            maskCanvas.height = img.height;
                            // Reset Mask Canvas
                            const maskCtx = maskCanvas.getContext("2d");
                            maskCtx.fillStyle = "#000";
                            maskCtx.fillRect(0, 0, img.width, img.height);
                            // Save Image and Resize Node
                            this.maskPainter.image = img;
                            const nodeWidth = this.size[0] || 400;
                            const availableWidth = nodeWidth - 20;
                            const aspectRatio = img.height / img.width;
                            const newWidgetHeight = Math.round(availableWidth * aspectRatio);
                            
                            this._isResizing = true;
                            this.maskPainter.widgetHeight = newWidgetHeight;
                            container.style.height = newWidgetHeight + "px";
                            this.setSize([nodeWidth, newWidgetHeight + 80]);
                            setTimeout(() => { this._isResizing = false; }, 50);

                            this.redrawCanvas();
                        };
                        img.src = `data:image/png;base64,${message.input_image[0]}`;
                    }
                };

                // 7. Resize Node
                const originalOnResize = this.onResize;
                this.onResize = function(size) {
                    if (originalOnResize) originalOnResize.apply(this, arguments);
                    if (this._isResizing) return;
                    this._isResizing = true;
                    const newWidgetHeight = Math.max(200, size[1] - 80);
                    if (Math.abs(newWidgetHeight - this.maskPainter.widgetHeight) > 5) {
                        this.maskPainter.widgetHeight = newWidgetHeight;
                        container.style.height = newWidgetHeight + "px";
                    }
                    setTimeout(() => { this._isResizing = false; }, 50);
                };

                // 8. Initialise
                this.redrawCanvas();
                const nodeWidth = Math.max(400, this.size[0] || 400);
                const nodeHeight = 380;
                this.setSize([nodeWidth, nodeHeight]);
                container.style.height = "300px";

                return result;
            };

            // 9. Function Line Painting
            nodeType.prototype.drawLine = function(x1, y1, x2, y2) {
                const { maskCtx, brushSize } = this.maskPainter;
                maskCtx.strokeStyle = "#fff";
                maskCtx.lineWidth = brushSize;
                maskCtx.lineCap = "round";
                maskCtx.lineJoin = "round";
                maskCtx.beginPath();
                maskCtx.moveTo(x1, y1);
                maskCtx.lineTo(x2, y2);
                maskCtx.stroke();
                this.updateMaskData();
                this.redrawCanvas();
            };

            // Update Mask Data
            nodeType.prototype.updateMaskData = function() {
                const { maskCanvas } = this.maskPainter;
                const maskDataWidget = this._hiddenWidgets?.mask_data || this.widgets.find(w => w.name === "mask_data");
                if (maskDataWidget) {
                    const maskBase64 = maskCanvas.toDataURL("image/png").split(",")[1];
                    maskDataWidget.value = JSON.stringify({
                        width: maskCanvas.width,
                        height: maskCanvas.height,
                        data: maskBase64
                    });
                }
            };

            // Canvas Repaint
            nodeType.prototype.redrawCanvas = function() {
                const { canvas, ctx, image, maskCanvas } = this.maskPainter;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                if (image) {
                    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                    ctx.globalAlpha = 0.5;
                    ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
                    ctx.globalAlpha = 1.0;
                    // Painting Info
                    ctx.fillStyle = "rgba(0,0,0,0.7)";
                    ctx.fillRect(5, canvas.height - 25, 150, 20);
                    ctx.fillStyle = "#0f0";
                    ctx.font = "12px monospace";
                    ctx.textAlign = "left";
                    ctx.fillText(`尺寸: ${canvas.width}x${canvas.height}`, 10, canvas.height - 10);
                } else {
                    ctx.fillStyle = "#333";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = "#666";
                    ctx.font = "16px sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillText("Paint After Excute This Node", canvas.width / 2, canvas.height / 2);
                    ctx.fillText("Left Mouse Click to Paint as Mask (White)", canvas.width / 2, canvas.height / 2 + 25);
                    ctx.fillText("Clear All: Delete Painted Mask", canvas.width / 2, canvas.height / 2 + 50);
                }
            };
        }
    }
});