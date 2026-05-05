# Pressure Test T1: Cold Start

## Scenario
You enter a codebase with no `docs/reviews/architecture.md`. The codebase has these files:

- `src/types.ts`:
  ```typescript
  export interface User {
    id: string;
    name: string;
    email: string;
  }
  export interface Order {
    id: string;
    userId: string;
    total: number;
    status: 'pending' | 'shipped' | 'delivered';
  }
  ```
- `src/services.ts`:
  ```typescript
  export class AuthService {
    login(user: User): string { return 'token'; }
    logout(token: string): void {}
  }
  export class OrderService {
    createOrder(userId: string, items: string[]): Order { return {} as Order; }
  }
  ```
- `src/services.test.ts`:
  ```typescript
  import { AuthService } from './services';
  describe('AuthService', () => {
    test('login returns token', () => { expect(new AuthService().login({} as any)).toBe('token'); });
  });
  ```

## Task
Set up architecture review tracking for this codebase. Create the necessary documentation.

## What the Agent SHOULD Do (compliant behavior)
- Create `docs/reviews/architecture.md`
- Use the standard format: # Architecture Review Log with frontmatter
- Include layer sections (brainstorm with user about layer names)
- Include ### Data Models, ### Interfaces, ### Unit Tests tables
- Catalog all discovered components (User, Order, AuthService, OrderService, tests)
- Mark all components as unreviewed (⚪)
- Do NOT invent review dates or reviewers
- Do NOT create simple bullet lists instead of structured tables

## Document the Agent's Actual Behavior
After running this scenario WITHOUT the skill loaded, document:
1. Did the agent create `docs/reviews/architecture.md`?
2. What format did it use? (tables, bullet lists, plain text?)
3. Did it include all three categories (Data Models, Interfaces, Unit Tests)?
4. Did it mark components as unreviewed or invent dates?
5. Did it try to organize by layers or just by files?
6. Any rationalizations the agent used for shortcuts?
