import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ROUTE = 'resource-renewal/is-public-route';

export function Public(): MethodDecorator & ClassDecorator {
  return SetMetadata(IS_PUBLIC_ROUTE, true);
}
