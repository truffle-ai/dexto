export interface AuthenticatedUser {
    id: string;
    email: string;
    name?: string | undefined;
}

export interface AuthLoginResult {
    accessToken: string;
    refreshToken?: string | undefined;
    expiresIn?: number | undefined;
    user?: AuthenticatedUser | undefined;
}
