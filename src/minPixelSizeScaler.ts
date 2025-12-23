import type { Gizmo } from './Gizmo'
import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  SceneMode,
} from 'cesium'

function getScaleInPixels(
  positionWC: Cartesian3,
  radius: number,
  frameState: any,
): number {
  const scratchBoundingSphere = new BoundingSphere()
  scratchBoundingSphere.center = positionWC
  scratchBoundingSphere.radius = radius
  return frameState.camera.getPixelSize(
    scratchBoundingSphere,
    frameState.context.drawingBufferWidth,
    frameState.context.drawingBufferHeight,
  )
}

export function getScaleForMinimumSize(model: Gizmo, frameState: any): number {
  const scratchPosition = new Cartesian3()
  const scratchCartographic = new Cartographic()

  // 计算包围球的像素大小
  const context = frameState.context
  const maxPixelSize = Math.max(
    context.drawingBufferWidth,
    context.drawingBufferHeight,
  )
  const m = model.modelMatrix
  scratchPosition.x = m[12]
  scratchPosition.y = m[13]
  scratchPosition.z = m[14]

  if (frameState.camera._scene.mode !== SceneMode.SCENE3D) {
    const projection = frameState.mapProjection
    const cartographic = projection.ellipsoid.cartesianToCartographic(
      scratchPosition,
      scratchCartographic,
    )
    projection.project(cartographic, scratchPosition)
    Cartesian3.fromElements(
      scratchPosition.z,
      scratchPosition.x,
      scratchPosition.y,
      scratchPosition,
    )
  }

  const radius = 1

  const metersPerPixel = getScaleInPixels(scratchPosition, radius, frameState)

  // metersPerPixel 始终大于 0.0
  const pixelsPerMeter = 1.0 / metersPerPixel
  const diameterInPixels = Math.min(
    pixelsPerMeter * 2.0 * radius,
    maxPixelSize,
  )

  let scale = 1
  // 维持模型的最小像素尺寸
  if (diameterInPixels < model.length) {
    scale = (model.length * metersPerPixel) / (2.0 * radius)
  }

  return scale
}
