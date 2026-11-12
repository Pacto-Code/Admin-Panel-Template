import "reflect-metadata";
import { Controller, Delete, Get, Module, Post, forwardRef } from "@nestjs/common";
import { expect, it } from "vitest";
import { Public, RequirePermission } from "../../src";
import { moduleRoutes } from "../../src/testing";

@Controller("admin/dep")
class DepController {
  @Public()
  @Get()
  list() {}
}
@Module({ controllers: [DepController] })
class DepModule {}

@Controller("admin/a/sub")
class SubController {
  @RequirePermission("a.sub.delete")
  @Delete(":id")
  remove() {}
}
@Module({ controllers: [SubController] })
class SubModule {}

@Controller("admin/a/items")
class ItemsController {
  @RequirePermission("a.item.read")
  @Get()
  list() {}
  @Public()
  @Post("ping")
  ping() {}
}
@Module({
  imports: [DepModule, forwardRef(() => SubModule), { module: class Dyn {}, controllers: [] }],
  controllers: [ItemsController],
})
class AModule {}

it("lists the routes of a module and its own imports, but not of its dependencies", () =>
  expect(moduleRoutes(AModule, [DepModule])).toEqual([
    { method: "GET", path: "/api/v1/admin/a/items", permission: "a.item.read" },
    { method: "POST", path: "/api/v1/admin/a/items/ping", permission: undefined },
    { method: "DELETE", path: "/api/v1/admin/a/sub/:id", permission: "a.sub.delete" },
  ]));
