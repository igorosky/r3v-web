import type { SceneSnapshot, SceneState, SetVisibilityCommand } from '../types.js';

/**
 * MVP stand-in for a renderer that cannot report its scene yet. Enabled by default and
 * disabled with `dev.sceneStub: false`; remove both once the renderer reports its scene.
 */
export const STUB_SCENE: SceneSnapshot = Object.freeze({
  elements: Object.freeze([
    Object.freeze({ id: 'voxels', label: 'Voxels', visible: true }),
    Object.freeze({ id: 'rover', label: 'Rover', visible: true }),
    Object.freeze({ id: 'manipulator', label: 'Manipulator', visible: true }),
  ]),
});

/** Answers a request the way a renderer would: with a full snapshot containing the change. */
export function answerStub(scene: SceneState, { id, visible }: SetVisibilityCommand): SceneSnapshot {
  return {
    elements: scene.elements.map((element) => ({
      id: element.id,
      label: element.label,
      visible: element.id === id ? visible : element.visible,
    })),
  };
}
