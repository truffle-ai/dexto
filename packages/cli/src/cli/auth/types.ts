export interface AuthenticatedUser {
    id: string;
    email: string;
    name?: string | undefined;
}

export interface DeviceApiKeyLoginResult {
    dextoApiKey: string;
    dextoKeyId: string;
    dextoKeyDisplay: string;
}
