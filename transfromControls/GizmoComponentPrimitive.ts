import type { Primitive } from 'cesium'
import type { Gizmo } from './Gizmo'
import { Cartesian3, destroyObject, Matrix4, Transforms } from 'cesium'
import { GizmoMode, TranslateMode } from './Gizmo'
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
    this._part = [] // [x, y, z]
    this._helper = [] // helper lines [x, y, z]
    this._show = true
    this._scale = 1
    this._scaleMatrix = new Matrix4()
    this._mode = mode
  }

  update(frameState: any) {
    if (!this._show) {
      return
    }

    // Sync gizmo location with mounted primitive when it changes externally
    this._gizmo.updateModelMatrixFromMountedPrimitive()

    // fix gizmo's screen size
    this._scale = getScaleForMinimumSize(this._gizmo, frameState)

    if (this._mode === GizmoMode.translate) {
      if (this._gizmo.transMode === TranslateMode.local) {
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
      // 旋转和缩放模式下，始终使用物体自身的坐标系
      this._scaleMatrix = Matrix4.multiplyByUniformScale(
        this._gizmo.modelMatrix,
        this._scale,
        new Matrix4(),
      )
    }

    for (const p of this._part) {
      p.modelMatrix = this._scaleMatrix
      // @ts-expect-error - Cesium Primitive.update() actually accepts frameState internally
      p.update(frameState)
    }

    // Update helper lines
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
        console.error('Error destroying part:', error)
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
        console.error('Error destroying helper:', error)
      }
    }
    this._helper = []

    return destroyObject(this)
  }
}
