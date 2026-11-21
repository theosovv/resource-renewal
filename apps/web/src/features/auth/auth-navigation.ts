export function defaultWorkspacePath(user: { memberships: Array<{ workspaceId: string }> }): string {
  const membership = user.memberships[0];
  return membership ? `/w/${membership.workspaceId}/renewals` : '/no-workspace';
}
