/* global __CVF_COCKPIT_BUILD__ */
import { isPreviewMode } from '@/lib/previewFlag';
export const isCockpitPreview = __CVF_COCKPIT_BUILD__ && isPreviewMode;
export const COCKPIT_CONTROLS_EVENT = 'cvf-cockpit-preview-controls';
