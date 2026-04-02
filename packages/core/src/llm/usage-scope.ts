import { z } from 'zod';

export const UsageScopeIdSchema = z.string().trim().min(1);

export type UsageScopeId = z.output<typeof UsageScopeIdSchema>;
