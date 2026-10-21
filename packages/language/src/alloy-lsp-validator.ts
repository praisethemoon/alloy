import { AstUtils, type LangiumDocument, type ValidationAcceptor, type ValidationChecks } from 'langium';
import type { AlloyLspAstType, Open, Specification } from './generated/ast.js';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import type { AlloyModuleResolver } from './alloy-lsp-modules.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: AlloyLspServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.AlloyLspValidator;
    const checks: ValidationChecks<AlloyLspAstType> = {
        Open: validator.checkOpenResolves
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class AlloyLspValidator {

    protected readonly modules: AlloyModuleResolver;

    constructor(services: AlloyLspServices) {
        this.modules = services.references.ModuleResolver;
    }

    checkOpenResolves(open: Open, accept: ValidationAcceptor): void {
        const document = AstUtils.getDocument(open) as LangiumDocument<Specification>;
        if (!this.modules.resolve(document, open.path)) {
            accept('error', `Cannot find module '${open.path}': no ${open.path}.als next to this module's root, no workspace module declares it, and it is not in the util library.`,
                { node: open, property: 'path' });
        }
    }

}
