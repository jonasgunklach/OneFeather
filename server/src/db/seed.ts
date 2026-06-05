import { db } from './index';
import { users, groups, groupMembers, nodes, permissions } from './schema';
import { hashPassword } from '../auth';

async function seed() {
  console.log('Seeding database with Unified Node Tree...');

  const now = new Date();

  // All seed users share the password "password" for local dev.
  const pw = await hashPassword('password');

  // Seed Users
  await db.insert(users).values([
    { id: 'admin', name: 'Admin', email: 'admin@onefeather.local', passwordHash: pw, globalRole: 'admin' },
    { id: 'alice', name: 'Alice', email: 'alice@onefeather.local', passwordHash: pw, globalRole: 'member' },
    { id: 'bob', name: 'Bob', email: 'bob@onefeather.local', passwordHash: pw, globalRole: 'member' },
  ]).onConflictDoNothing();

  // Seed Groups (Org Chart)
  await db.insert(groups).values([
    { id: 'group-org', name: 'Global Organization', parentId: null },
    { id: 'group-eng', name: 'Engineering', parentId: 'group-org' },
    { id: 'group-frontend', name: 'Frontend Team', parentId: 'group-eng' }
  ]).onConflictDoNothing();

  // Add Alice to Frontend Team (deepest node)
  await db.insert(groupMembers).values([
    { groupId: 'group-frontend', userId: 'alice' }
  ]).onConflictDoNothing();

  // Add Bob to an entirely different part of the Org
  await db.insert(groupMembers).values([
    { groupId: 'group-org', userId: 'bob' }
  ]).onConflictDoNothing();

  // Seed Nodes
  // 1. A Shared Drive shared with Engineering
  await db.insert(nodes).values([
    { id: 'drive-eng', type: 'drive', name: 'Engineering Shared Drive', ownerId: 'admin', createdAt: now },
    { id: 'folder-specs', type: 'folder', parentId: 'drive-eng', name: 'Product Specs', ownerId: 'admin', createdAt: now },
    { id: 'doc-roadmap', type: 'document', parentId: 'folder-specs', name: 'Q3 Roadmap', ownerId: 'alice', createdAt: now },
  ]).onConflictDoNothing();

  // 2. A Global Drive
  await db.insert(nodes).values([
    { id: 'drive-global', type: 'drive', name: 'Company All-Hands', ownerId: 'admin', createdAt: now },
  ]).onConflictDoNothing();

  // 3. Alice's Personal "My Drive" (nodes without a parent)
  await db.insert(nodes).values([
    { id: 'folder-alice-private', type: 'folder', name: 'Alice Private Notes', ownerId: 'alice', createdAt: now },
    { id: 'doc-secret', type: 'document', parentId: 'folder-alice-private', name: 'Secret Ideas', ownerId: 'alice', createdAt: now },
  ]).onConflictDoNothing();

  // Seed Permissions (ACL)
  // Give Engineering Group 'editor' access to the Engineering Shared Drive
  await db.insert(permissions).values({
    id: 'perm-eng-drive', nodeId: 'drive-eng', granteeType: 'group', granteeId: 'group-eng', role: 'editor'
  }).onConflictDoNothing();
  
  // Give Global Org 'viewer' access to the Global Drive
  await db.insert(permissions).values({
    id: 'perm-global-drive', nodeId: 'drive-global', granteeType: 'group', granteeId: 'group-org', role: 'viewer'
  }).onConflictDoNothing();

  // Alice has 'manager' access to her private folder
  await db.insert(permissions).values({
    id: 'perm-alice-private', nodeId: 'folder-alice-private', granteeType: 'user', granteeId: 'alice', role: 'manager'
  }).onConflictDoNothing();

  console.log('Unified Node Tree seeded successfully!');
}

seed().catch(console.error);
