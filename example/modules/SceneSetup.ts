import type * as CesiumType from 'cesium'

export function setupScene(Cesium: typeof CesiumType, containerId: string) {
  Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjMzg0MGU4ZC0zODc3LTRjYjYtOWVhZC02MmJjZjllODNmY2IiLCJpZCI6MTc4MjgwLCJpYXQiOjE3NzUyMDcxNTd9.x8DGiaSc-ys6fsMwVr2Y7v5RsfUSXqKOSN_JQf8DshM';

  const viewer = new Cesium.Viewer(containerId, {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    infoBox: false,
  })
  // viewer.extend(Cesium.viewerCesiumInspectorMixin);

  return viewer
}
