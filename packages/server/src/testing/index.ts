/** Test helpers for modules: `@platform/server/testing`. Kept out of the main barrel so production code never loads Vitest or supertest. */
export { createTestApp, type SuperTestAgent, type TestApp, type TestModule } from "./test-app";
export {
  createdTables,
  describeModuleContract,
  moduleRoutes,
  undeclaredPermissions,
  unguardedRoutes,
  unprefixedTables,
  type ModuleRoute,
} from "./module-contract";
export { FakeAccess, FakeMailer, FakeRecorder, TEST_ACTOR_HEADER, type TestActor } from "./fakes";
