export const queryKeys = {
  workspaces: ['workspaces'] as const,
  resources: (workspaceId: string) => ['workspaces', workspaceId, 'resources'] as const,
  requests: (workspaceId: string) => ['workspaces', workspaceId, 'requests'] as const,
  request: (workspaceId: string, requestId: string) =>
    ['workspaces', workspaceId, 'requests', requestId] as const,
};
