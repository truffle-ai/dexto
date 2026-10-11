# Spec Delta

## Purpose

Apply an HTTP server's configured authentication consistently to its MCP endpoint without exposing protocol payloads in logs.

## ADDED Requirements

### Requirement: HTTP MCP follows server authorization

The agent HTTP server SHALL apply the same configured authentication policy to MCP requests as to protected HTTP API requests. Explicit externally owned authentication SHALL remain supported. Development authentication defaults SHALL remain compatible.

#### Scenario: Protected server rejects an MCP caller

- **WHEN** authentication is required and a caller sends an MCP request without a valid bearer credential
- **THEN** the server rejects it before protocol handling

#### Scenario: Missing server key

- **WHEN** authentication is required but no server key is configured
- **THEN** MCP requests fail closed with a configuration error

#### Scenario: External authorization owner

- **WHEN** the host explicitly disables built-in authentication to provide its own boundary
- **THEN** the MCP bridge honors that configured ownership

### Requirement: Exact endpoint and private diagnostics

The raw HTTP MCP bridge SHALL handle only its designated MCP endpoint and SHALL NOT log request bodies, credentials or raw upstream error payloads.

#### Scenario: Ordinary API path

- **WHEN** a request targets an API path beginning with the same characters as the MCP endpoint
- **THEN** normal HTTP routing handles it rather than the MCP transport
