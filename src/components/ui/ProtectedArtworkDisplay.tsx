import { useEffect, useRef, useState } from 'react';
import type { ProtectionSettings } from '../../lib/supabaseProtection';

interface ProtectedArtworkDisplayProps {
  src: string;
  alt: string;
  settings?: Pick<ProtectionSettings, 'dynamic_cloaking' | 'canvas_tiling' | 'right_click_shield'>;
  className?: string;
  fitMode?: 'cover' | 'contain';
  onContextMenuBlocked?: () => void;
}

function drawCanvasImage(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  settings: Pick<ProtectionSettings, 'dynamic_cloaking' | 'canvas_tiling' | 'right_click_shield'>,
  fitMode: 'cover' | 'contain',
): void {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const width = fitMode === 'contain' ? Math.max(1, Math.round(canvas.clientWidth)) : sourceWidth;
  const height = fitMode === 'contain' ? Math.max(1, Math.round(canvas.clientHeight)) : sourceHeight;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not render the protected preview.');

  if (fitMode === 'contain') {
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const fittedWidth = sourceWidth * scale;
    const fittedHeight = sourceHeight * scale;
    const offsetX = (width - fittedWidth) / 2;
    const offsetY = (height - fittedHeight) / 2;
    const columns = settings.canvas_tiling ? 4 : 1;
    const rows = settings.canvas_tiling ? 4 : 1;
    const tileWidth = sourceWidth / columns;
    const tileHeight = sourceHeight / rows;

    context.clearRect(0, 0, width, height);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const sourceX = column * tileWidth;
        const sourceY = row * tileHeight;
        context.drawImage(
          image,
          sourceX,
          sourceY,
          tileWidth,
          tileHeight,
          offsetX + sourceX * scale,
          offsetY + sourceY * scale,
          tileWidth * scale,
          tileHeight * scale,
        );
      }
    }

    if (settings.dynamic_cloaking) {
      const cellSize = Math.max(24 * scale, Math.round(Math.min(fittedWidth, fittedHeight) / 18));
      context.fillStyle = 'rgba(255, 255, 255, 0.035)';
      for (let y = offsetY; y < offsetY + fittedHeight; y += cellSize) {
        for (let x = offsetX; x < offsetX + fittedWidth; x += cellSize) {
          if (Math.floor((x - offsetX) / cellSize + (y - offsetY) / cellSize) % 3 === 0) {
            context.fillRect(x, y, Math.min(cellSize, offsetX + fittedWidth - x), Math.min(cellSize, offsetY + fittedHeight - y));
          }
        }
      }
    }
    return;
  }

  if (!settings.canvas_tiling) {
    context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  } else {
    const columns = 4;
    const rows = 4;
    const tileWidth = width / columns;
    const tileHeight = height / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const sourceX = column * tileWidth;
        const sourceY = row * tileHeight;
        context.drawImage(image, sourceX, sourceY, tileWidth, tileHeight, sourceX, sourceY, tileWidth, tileHeight);
      }
    }
  }

  if (settings.dynamic_cloaking) {
    const cellSize = Math.max(24, Math.round(Math.min(width, height) / 18));
    context.fillStyle = 'rgba(255, 255, 255, 0.035)';
    for (let y = 0; y < height; y += cellSize) {
      for (let x = 0; x < width; x += cellSize) {
        if ((x / cellSize + y / cellSize) % 3 === 0) context.fillRect(x, y, cellSize, cellSize);
      }
    }
  }
}

export function ProtectedArtworkDisplay({
  src,
  alt,
  settings,
  className,
  fitMode = 'cover',
  onContextMenuBlocked,
}: ProtectedArtworkDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState<string | undefined>();
  const [sourceAspectRatio, setSourceAspectRatio] = useState<number>();
  const useCanvas = Boolean(settings?.canvas_tiling || settings?.dynamic_cloaking);
  const rightClickShield = Boolean(settings?.right_click_shield);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    const render = () => {
      if (cancelled || !image.naturalWidth || !image.naturalHeight) return;
      setSourceAspectRatio(image.naturalWidth / image.naturalHeight);
      if (!useCanvas || !canvasRef.current || !settings) return;
      try {
        drawCanvasImage(canvasRef.current, image, settings, fitMode);
        setRenderError(undefined);
      } catch (error) {
        setRenderError(error instanceof Error ? error.message : 'Protected preview could not be rendered.');
      }
    };
    image.onload = render;
    image.onerror = () => setRenderError('Protected preview could not be loaded.');
    image.src = src;
    const resizeObserver = useCanvas && fitMode === 'contain' && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(render)
      : undefined;
    if (resizeObserver && canvasRef.current?.parentElement) {
      resizeObserver.observe(canvasRef.current.parentElement);
    }
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
    };
  }, [fitMode, settings, src, useCanvas]);

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!rightClickShield) return;
    event.preventDefault();
    onContextMenuBlocked?.();
  };

  const handleDragStart = (event: React.DragEvent) => {
    if (rightClickShield) event.preventDefault();
  };

  return (
    <div
      className={className}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      style={{
        width: '100%',
        height: fitMode === 'contain' ? 'auto' : '100%',
        aspectRatio: fitMode === 'contain' ? sourceAspectRatio ?? 1 : undefined,
      }}
    >
      {renderError ? <span role="img" aria-label={alt}>{renderError}</span> : !useCanvas ? (
        <img
          src={src}
          alt={alt}
          draggable={rightClickShield ? false : undefined}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: fitMode,
          }}
        />
      ) : (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={alt}
          draggable={rightClickShield ? false : undefined}
          onDragStart={handleDragStart}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: fitMode === 'contain' ? 'fill' : fitMode,
          }}
        />
      )}
    </div>
  );
}