import type * as Cesium from 'cesium'
import type { Gizmo, GizmoPointerDownEvent, GizmoPointerMoveEvent, GizmoPointerUpEvent } from 'cesium-transform-controls'
import { GizmoMode, CoordinateMode } from 'cesium-transform-controls'

export function setupGizmo(
  GizmoClass: new (options: any) => Gizmo,
  viewer: Cesium.Viewer,
  options: any = {}
) {
  const defaultOptions = {
    showLocalBounds: true,
    showWorldAABB: false,
    onGizmoPointerMove: (event: GizmoPointerMoveEvent) => {
      console.log('[Gizmo Move]', event)
    },
    onGizmoPointerDown: (event: GizmoPointerDownEvent) => {
      console.log('[Gizmo Down]', event)
    },
    onGizmoPointerUp: (event: GizmoPointerUpEvent) => {
      console.log('[Gizmo Up]', event)
    }
  }

  // Allow mapping onMove to onGizmoPointerMove for convenience if passed
  if (options.onMove) {
      const original = options.onGizmoPointerMove
      options.onGizmoPointerMove = (e: any) => {
          if (original) original(e)
          options.onMove(e)
      }
  }

  const gizmo = new GizmoClass({
    ...defaultOptions,
    ...options
  })
  
  gizmo.attach(viewer)
  gizmo.setMode(GizmoMode.translate)
  gizmo.coordinateMode = CoordinateMode.local
  
  return gizmo
}
