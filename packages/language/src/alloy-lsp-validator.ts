import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type { AlloyLspAstType, Person } from './generated/ast.js';
import type { AlloyLspServices } from './alloy-lsp-module.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: AlloyLspServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.AlloyLspValidator;
    const checks: ValidationChecks<AlloyLspAstType> = {
        Person: validator.checkPersonStartsWithCapital
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class AlloyLspValidator {

    checkPersonStartsWithCapital(person: Person, accept: ValidationAcceptor): void {
        if (person.name) {
            const firstChar = person.name.substring(0, 1);
            if (firstChar.toUpperCase() !== firstChar) {
                accept('warning', 'Person name should start with a capital.', { node: person, property: 'name' });
            }
        }
    }

}
