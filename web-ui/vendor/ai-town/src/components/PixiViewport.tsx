// Based on https://codepen.io/inlet/pen/yLVmPWv.
// Copyright (c) 2018 Patrick Brouwer, distributed under the MIT license.

import { PixiComponent } from '@pixi/react';
import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { MutableRefObject, ReactNode } from 'react';

export type ViewportProps = {
  [key: string]: unknown;
  app: Application;
  viewportRef?: MutableRefObject<Viewport | undefined>;

  screenWidth: number;
  screenHeight: number;
  worldWidth: number;
  worldHeight: number;
  children?: ReactNode;
};

// https://davidfig.github.io/pixi-viewport/jsdoc/Viewport.html
export default PixiComponent('Viewport', {
  create(props: ViewportProps) {
    const { app, viewportRef, ...viewportProps } = props;
    // GhostForge: pixi-viewport 5.1 ships stale typings (`interaction`) while its
    // runtime reads `events`; the cast is the only deviation from upstream.
    const viewport = new Viewport({
      events: app.renderer.events,
      passiveWheel: false,
      ...viewportProps,
    } as ConstructorParameters<typeof Viewport>[0]);
    if (viewportRef) {
      viewportRef.current = viewport;
    }
    // Activate plugins
    viewport
      .drag()
      .pinch({})
      .wheel()
      .decelerate()
      .clamp({ direction: 'all', underflow: 'center' })
      .setZoom(-10)
      .clampZoom({
        minScale: (1.04 * props.screenWidth) / (props.worldWidth / 2),
        maxScale: 3.0,
      });
    return viewport;
  },
  applyProps(viewport, oldProps: ViewportProps, newProps: ViewportProps) {
    Object.keys(newProps).forEach((p) => {
      if (p !== 'app' && p !== 'viewportRef' && p !== 'children' && oldProps[p] !== newProps[p]) {
        // @ts-expect-error Ignoring TypeScript here
        viewport[p] = newProps[p];
      }
    });
  },
});
