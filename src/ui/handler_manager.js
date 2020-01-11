// @flow

import {MapMouseEvent, MapTouchEvent, MapWheelEvent} from '../ui/events';
import {Event} from '../util/evented';
import DOM from '../util/dom';
import type Map from './map';
import Handler from './handler/handler';
import { TouchPanHandler, TouchZoomHandler, TouchRotateHandler, TouchPitchHandler } from './handler/touch';
import {extend} from '../util/util';


class HandlerManager {
  _map: Map;
  _el: HTMLElement;
  _handlers: Array<Handler>;

  /**
   * @private
   */
  constructor(map: Map, options?: Object) {
    this._map = map;
    this._el = this._map.getCanvasContainer();
    this._handlers = [];
    this._disableDuring = {};

    // Track whether map is currently moving, to compute start/move/end events
    this._eventsInProgress = {
      zoom: false,
      rotate: false,
      pitch: false,
      drag: false
    };


    this._addDefaultHandlers();

    // Bind touchstart and touchmove with passive: false because, even though
    // they only fire a map events and therefore could theoretically be
    // passive, binding with passive: true causes iOS not to respect
    // e.preventDefault() in _other_ handlers, even if they are non-passive
    // (see https://bugs.webkit.org/show_bug.cgi?id=184251)
    this.addTouchListener('touchstart', {passive: false});
    this.addTouchListener('touchmove', {passive: false});
    this.addTouchListener('touchend');
    this.addTouchListener('touchcancel');

    this.addMouseListener('mousedown');
    this.addMouseListener('mousemove');
    this.addMouseListener('mouseup');
    this.addMouseListener('mouseover');
    this.addMouseListener('mouseout');
  }

  _addDefaultHandlers() {
    this.add('touchRotate', new TouchRotateHandler(this._map), ['touchPitch']);
    this.add('touchPitch', new TouchPitchHandler(this._map), ['touchRotate']);
    this.add('touchZoom', new TouchZoomHandler(this._map), ['touchPitch']);
    this.add('touchPan', new TouchPanHandler(this._map), ['touchPitch']);
  }

  list() {
    return this._handlers.map(([name, handler]) => name);
  }

  get length() {
    return this._handlers.length;
  }

  add(handlerName: string, handler: Handler, disableDuring: Array<string>) {
    if (!handlerName || !(/^[a-z]+[a-zA-Z]*$/.test(handlerName))) throw new Error('Must provide a valid handlerName string');
    if (!handler || !(handler instanceof Handler)) throw new Error('Must provide a valid Handler instance');

    if (this[handlerName]) throw new Error(`Cannot add ${handlerName}: a handler with that name already exists`);
    for (const [existingName, existingHandler] of this._handlers) {
      if (existingHandler === handler) throw new Error(`Cannot add ${handler} as ${handlerName}: handler already exists as ${existingName}`);
    }
    this._handlers.push([handlerName, handler]);
    this[handlerName] = handler;

    if (disableDuring) {
      this._disableDuring[handlerName] = disableDuring;
    }
  }

  remove(handlerName: string) {
    if (!handlerName || typeof handlerName !== 'string') throw new Error('Must provide a valid handlerName string');
    if (!this[handlerName]) throw new Error(`Handler ${handlerName} not found`);
    const newHandlers = this._handlers.filter(([existingName, existingHandler]) => {
      if (existingName === handlerName) {
        delete this[handlerName];
        return false;
      }
      return true;
    });
    this._handlers = newHandlers;
  }

  removeAll() {
    for (const [handlerName, _] of this._handlers) this.remove(handlerName);
  }

  disableAll() {
    for (const [_, handler] of this._handlers) handler.disable();
  }

  enableAll() {
    for (const [_, handler] of this._handlers) handler.enable();
  }

  addListener(mapEventClass: Event, eventType: string, options?: Object) {
    const listener = (e: Event) => {
      this._map.fire(new mapEventClass(eventType, this._map, e));
      this.processInputEvent(e);
    };
    DOM.addEventListener(this._el, eventType, listener, options);
  }

  addTouchListener(eventType: string, options?: Object) {
    this.addListener(MapTouchEvent, eventType, options);
  }

  addMouseListener(eventType: string, options?: Object) {
    this.addListener(MapMouseEvent, eventType, options);
  }


  processInputEvent(e: MouseEvent | TouchEvent | KeyboardEvent | WheelEvent) {
    if (e.cancelable) e.preventDefault();
    let transformSettings;
    let activeHandlers = [];

    for (const [name, handler] of this._handlers) {
      if (!handler.isEnabled()) continue;
      let data = handler.processInputEvent(e);
      if (!data) continue;

      if (this._disableDuring[name]) {
        const conflicts = this._disableDuring[name].filter(otherHandler => activeHandlers.indexOf(otherHandler) > -1);
        if (conflicts.length > 0) {
          handler.reset(e);
          continue;
        }
      }
      // validate the update request
      if (data.transform) {
        const merged = data.transform
        if (!!transformSettings) extend(merged, transformSettings)
        transformSettings = merged;
      }
      activeHandlers.push(name);
    }

    if (transformSettings) this.updateAndFire(transformSettings, e);
    // if (eventsToFire.length > 0) this.fireMapEvents(eventsToFire, e);
  }

  updateAndFire(settings, originalEvent) {
    const eventsToFire = {
      zoom: false,
      rotate: false,
      pitch: false,
      drag: false
    };
    const tr = this._map.transform;

    let { zoomDelta, bearingDelta, pitchDelta, setLocationAtPoint } = settings;
    if (zoomDelta) { tr.zoom += zoomDelta; eventsToFire['zoom'] = true; }
    if (bearingDelta) { tr.bearing += bearingDelta; eventsToFire['rotate'] = true; }
    if (pitchDelta) { tr.pitch += pitchDelta; eventsToFire['pitch'] = true; }
    if (setLocationAtPoint && setLocationAtPoint.length === 2) {
      let [loc, pt] = setLocationAtPoint;
      tr.setLocationAtPoint(loc, pt);
      eventsToFire['drag'] = true;
    }

    const [preUpdateEvents, postUpdateEvents] = this._computeEvents(eventsThisUpdate);
    this._fireMapEvents(preUpdateEvents, originalEvent);
    this._map._update();
    this._fireMapEvents(postUpdateEvents, originalEvent);
  }

  _computeEvents(events) {
    const preUpdateEvents = [];
    const postUpdateEvents = [];
    const movestart = true;
    for (const eventType of ['zoom', 'rotate', 'pitch', 'drag']) {

    }
    // if we weren't already eventing this event, fire start & change event progress state
    // if we are already eventing this event, fire move & no state change
    // if we were eventing this event and now we're not, fire end & change event progress state
    // return [preUpdateEvents, postUpdateEvents];
  }

  _firePreMoveEvents(events, originalEvent) {
    // Start events should be fired before updating the map
    const startEvents = [];
    const movestart = true;
    for (const event of ['zoom', 'rotate', 'pitch', 'drag']) {
      const currentEvent = events[event];
      const alreadyInProgress = this._eventsInProgress[event];

      // If we're requesting this event

      // If we're not requesting this event, but we were previously

      if (alreadyInProgress) continue; // No start event needed


      if (!this._eventsInProgress[event]) {
        // If we need to event and we're not eventing already, fire start

      } else {
        // We are already doing some kind of move; no movestart event
        movestart = false;
      }
    }
    if (startEvents.length > 0) {
      if (movestart) startEvents.push('movestart');
      this.fireMapEvents(startEvents, originalEvent);
    }
  }

  _firePostMoveEvents(events, originalEvent) {
    // Move and End events should be fired after updating the map
  }

  fireMapEvents(events, originalEvent) {
    for (const eventType of events) {
      this._map.fire(new Event(eventType, { originalEvent }));
    }
  }
}


export default HandlerManager;
