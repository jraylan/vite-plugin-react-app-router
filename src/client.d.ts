/**
 * Tipos para o entry point do cliente
 */

// @ts-ignore
export { AppRouter, router, routes, useTemplateLink, default } from 'virtual:app-router';
export { useSlot, useSharedModule, useSharedSlot, useSharedProps } from './runtime.js';
export type {
    SharedModuleInfo,
    TemplateLinkFn,
    TemplateLinkParams,
    TemplateLinkOptions,
    TemplateInvocation,
    TemplateRegistry,
} from './runtime.js';
