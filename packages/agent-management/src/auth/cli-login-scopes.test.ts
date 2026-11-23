import { describe, expect, it } from 'vitest';
import { dextoSignIn } from '../index.js';

describe('CLI_LOGIN_SCOPES', () => {
    it('is exported from the package root for Cloud to test its sign-in against', () => {
        expect(dextoSignIn.CLI_LOGIN_SCOPES).toEqual([
            'apps:execute',
            'apps:read',
            'apps:write',
            'artifacts:read',
            'artifacts:write',
            'chats:sync',
            'cloud:read',
            'cloud:write',
            'computers:read',
            'computers:write',
            'connections:read',
            'connectors:import',
            'contacts:read',
            'contacts:write',
            'drive:read',
            'drive:write',
            'functions:read',
            'functions:write',
            'marketplace:read',
            'marketplace:write',
            'messages:read',
            'messages:write',
            'network:read',
            'network:write',
            'notifications:read',
            'notifications:write',
            'projects:read',
            'projects:write',
            'sessions:read',
            'sessions:write',
            'sites:read',
            'sites:write',
            'skills:read',
            'skills:write',
        ]);
    });

    it('names each scope once', () => {
        expect(new Set(dextoSignIn.CLI_LOGIN_SCOPES).size).toBe(
            dextoSignIn.CLI_LOGIN_SCOPES.length
        );
    });
});
