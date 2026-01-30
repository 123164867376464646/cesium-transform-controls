import type * as CesiumType from 'cesium'

export function setupScene(Cesium: typeof CesiumType, containerId: string) {
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
