import type { Role } from '@factory/shared';

declare global {
  namespace App {
    interface Locals {
      user: { id: string; name: string; email: string; role: Role } | null;
    }
  }
}
