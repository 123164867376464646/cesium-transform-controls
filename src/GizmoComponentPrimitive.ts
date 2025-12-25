import type { Primitive } from 'cesium'
import type { Gizmo } from './Gizmo'
import { Cartesian3, destroyObject, Matrix4, Transforms } from 'cesium'
import { GizmoMode, CoordinateMode } from './Gizmo'
import { getScaleForMinimumSize } from './minPixelSizeScaler'

export class GizmoComponentPrimitive {
  _gizmo: Gizmo
  _part: Primitive[]
  _helper: Primitive[]
  _show: boolean
  _scale: number
  _scaleMatrix: Matrix4
  _mode: GizmoMode
  constructor(gizmo: Gizmo, mode: GizmoMode) {
    this._gizmo = gizmo
    this._part = [] // [x轴, y轴, z轴]
    this._helper = [] // 辅助线 [x轴, y轴, z轴]
    this._show = true
    this._scale = 1
    this._scaleMatrix = new Matrix4()
    this._mode = mode
  }

  update(frameState: any) {
    if (!this._show) {
      return
    }

    // 当挂载的图元位置发生外部变化时，同步 Gizmo 位置
    this._gizmo.updateModelMatrixFromMountedPrimitive()
    // 持续更新包围盒（交互过程中和非交互状态都需要）
    this._gizmo._updateBoundingBoxes()

    // 修正 Gizmo 的屏幕尺寸
    this._scale = getScaleForMinimumSize(this._gizmo, frameState)

    if (this._mode === GizmoMode.translate) {
      if (this._gizmo.coordinateMode === CoordinateMode.local) {
        // Local模式：使用物体自身的旋转坐标系（轴向跟随物体旋转）
        this._scaleMatrix = Matrix4.multiplyByUniformScale(
          this._gizmo.modelMatrix,
          this._scale,
          new Matrix4(),
        )
      }
      else {
        // Surface模式：使用地表ENU坐标系（轴向固定指向东-北-上）
        const NEUMatrix = Transforms.eastNorthUpToFixedFrame(
          Matrix4.getTranslation(this._gizmo.modelMatrix, new Cartesian3()),
        )
        this._scaleMatrix = Matrix4.multiplyByUniformScale(NEUMatrix, this._scale, NEUMatrix)
      }
    }
    else {
      if (this._mode === GizmoMode.rotate) {
        if (this._gizmo.coordinateMode === CoordinateMode.local) {
          // Local模式：轴向跟随物体
          this._scaleMatrix = Matrix4.multiplyByUniformScale(
            this._gizmo.modelMatrix,
            this._scale,
            new Matrix4(),
          )
        }
        else {
          // Surface模式：轴向固定 ENU
          const NEUMatrix = Transforms.eastNorthUpToFixedFrame(
            Matrix4.getTranslation(this._gizmo.modelMatrix, new Cartesian3()),
          )
          this._scaleMatrix = Matrix4.multiplyByUniformScale(NEUMatrix, this._scale, NEUMatrix)
        }
      }
      else {
        // Scale 模式：始终使用 Local（忽略 coordinateMode）
        this._scaleMatrix = Matrix4.multiplyByUniformScale(
          this._gizmo.modelMatrix,
          this._scale,
          new Matrix4(),
        )
      }
    }


    for (const p of this._part) {
      p.modelMatrix = this._scaleMatrix
      // @ts-expect-error - Cesium Primitive.update() actually accepts frameState internally
      p.update(frameState)
    }

    // 更新辅助线
    for (const h of this._helper) {
      h.modelMatrix = this._scaleMatrix
      // @ts-expect-error - Cesium Primitive.update() actually accepts frameState internally
      h.update(frameState)
    }
  }

  isDestroyed() {
    return false
  }

  destroy() {
    // 销毁 _part 数组中的所有对象
    for (const p of this._part) {
      try {
        if (p && !p.isDestroyed?.()) {
          p.destroy()
        }
      }
      catch (error) {
        console.error('销毁部件时出错:', error)
      }
    }
    this._part = []

    // 销毁 _helper 数组中的所有对象（如果有）
    for (const h of this._helper) {
      try {
        if (h && !h.isDestroyed?.()) {
          h.destroy()
        }
      }
      catch (error) {
        console.error('销毁辅助线时出错:', error)
      }
    }
    this._helper = []

    return destroyObject(this)
  }
}
