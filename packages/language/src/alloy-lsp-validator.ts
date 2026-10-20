import type { ValidationChecks } from 'langium';
import type { AlloyLspAstType } from './generated/ast.js';
import type { AlloyLspServices } from './alloy-lsp-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: AlloyLspServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.AlloyLspValidator;
    const checks: ValidationChecks<AlloyLspAstType> = {};
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class AlloyLspValidator {
}
