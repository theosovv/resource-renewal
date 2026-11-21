import { useOutletContext } from 'react-router-dom';
import type { Workspace } from '../../api/client';

export function useWorkspace(): Workspace {
  return useOutletContext<Workspace>();
}
