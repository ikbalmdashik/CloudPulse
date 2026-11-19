import { createUserSchema } from './create-user.schema.js';
import { listUsersQuerySchema } from './list-users.schema.js';
import { updateRoleSchema } from './update-role.schema.js';

/** `[path, message]` pairs, as the validation pipe would report them. */
const issuesOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  r.error?.issues.map((i) => [i.path.join('.'), i.message]);

describe('createUserSchema', () => {
  it('normalises a valid body', () => {
    expect(
      createUserSchema.parse({ email: '  Alice@Example.COM ', fullName: ' Alice Smith ', password: 'secret123' }),
    ).toEqual({ email: 'alice@example.com', fullName: 'Alice Smith', password: 'secret123' });
  });

  it('rejects a role field: sign-up cannot choose a role', () => {
    const r = createUserSchema.safeParse({ email: 'a@b.io', fullName: 'Sam', password: 'secret123', role: 'ADMIN' });
    expect(issuesOf(r)).toEqual([['', 'Unrecognized key: "role"']]);
  });

  it('reports every invalid field at once', () => {
    expect(issuesOf(createUserSchema.safeParse({ email: 'nope', password: 'short' }))).toEqual([
      ['email', 'must be a valid email address'],
      ['fullName', 'is required and must be a string'],
      ['password', 'must be 8-128 characters'],
      ['password', 'must contain at least one digit'],
    ]);
  });

  it('requires a letter and a digit in the password', () => {
    expect(issuesOf(createUserSchema.safeParse({ email: 'a@b.io', fullName: 'Sam', password: '12345678' }))).toEqual([
      ['password', 'must contain at least one letter'],
    ]);
  });

  it.each([null, [], 'text', 42])('rejects a non-object body (%j)', (body) => {
    expect(createUserSchema.safeParse(body).success).toBe(false);
  });
});

describe('updateRoleSchema', () => {
  it.each(['SUPERVISOR', 'OPERATOR'])('accepts %s', (role) => {
    expect(updateRoleSchema.parse({ role })).toEqual({ role });
  });

  it.each(['ADMIN', undefined, 'supervisor'])('rejects role %j', (role) => {
    expect(issuesOf(updateRoleSchema.safeParse({ role }))).toEqual([
      ['role', 'must be one of SUPERVISOR, OPERATOR'],
    ]);
  });

  it('rejects extra fields', () => {
    expect(updateRoleSchema.safeParse({ role: 'SUPERVISOR', isActive: true }).success).toBe(false);
  });
});

describe('listUsersQuerySchema', () => {
  it('applies defaults and coerces query-string numbers', () => {
    expect(listUsersQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(listUsersQuerySchema.parse({ role: 'OPERATOR', search: ' ali ', limit: '10', offset: '20' })).toEqual({
      role: 'OPERATOR',
      search: 'ali',
      limit: 10,
      offset: 20,
    });
  });

  it('rejects bad values', () => {
    expect(issuesOf(listUsersQuerySchema.safeParse({ role: 'ROOT', limit: '500', offset: '-1' }))).toEqual([
      ['role', 'must be one of OPERATOR, SUPERVISOR, ADMIN'],
      ['limit', 'must be 1-100'],
      ['offset', 'must be 0 or more'],
    ]);
  });
});
