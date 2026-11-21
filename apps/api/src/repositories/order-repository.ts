import type { EstadoDespacho } from "@stockagent/shared";
import type { TenantScope } from "./base.js";
import {
  CustomerRepository,
  type CustomerRecord,
} from "./orders/customer-repository.js";
import { DispatchRepository } from "./orders/dispatch-repository.js";
import { OrderOperationsRepository } from "./orders/operations-repository.js";
import {
  OrderCoreRepository,
  type OrderRecord,
  type RegisterOrderInput,
} from "./orders/order-core-repository.js";

export {
  CustomerRepository,
  DispatchRepository,
  OrderCoreRepository,
  OrderOperationsRepository,
  type CustomerRecord,
  type OrderRecord,
  type RegisterOrderInput,
};

/**
 * Fachada compatible hacia atrás que delega en repositorios especializados
 * (clientes, pedidos, despacho/locks y operaciones/planes).
 */
export class OrderRepository {
  private readonly customers = new CustomerRepository();
  private readonly orders = new OrderCoreRepository();
  private readonly dispatch = new DispatchRepository();
  private readonly operations = new OrderOperationsRepository();

  listCustomers(scope: TenantScope): Promise<CustomerRecord[]> {
    return this.customers.listCustomers(scope);
  }

  createOrReactivateCustomer(
    scope: TenantScope,
    input: Parameters<CustomerRepository["createOrReactivateCustomer"]>[1]
  ): Promise<CustomerRecord> {
    return this.customers.createOrReactivateCustomer(scope, input);
  }

  registerOrder(
    scope: TenantScope,
    input: RegisterOrderInput
  ): Promise<OrderRecord> {
    return this.orders.registerOrder(scope, input);
  }

  findExistingOrdersByNotas(
    scope: TenantScope,
    notas: readonly string[]
  ): Promise<Set<string>> {
    return this.orders.findExistingOrdersByNotas(scope, notas);
  }

  findConfirmedOrdersByHashes(
    scope: TenantScope,
    hashes: readonly string[]
  ): Promise<Map<string, string>> {
    return this.orders.findConfirmedOrdersByHashes(scope, hashes);
  }

  listOrders(
    scope: TenantScope,
    options?: {
      estadoDespacho?: EstadoDespacho | undefined;
      limit?: number | undefined;
    }
  ): Promise<OrderRecord[]> {
    return this.orders.listOrders(scope, options);
  }

  getOrderWithItems(scope: TenantScope, notaPedido: string) {
    return this.orders.getOrderWithItems(scope, notaPedido);
  }

  listOrdersWithItems(
    scope: TenantScope,
    options?: {
      estadoDespacho?: EstadoDespacho | undefined;
      limit?: number | undefined;
    }
  ) {
    return this.orders.listOrdersWithItems(scope, options);
  }

  advanceDispatchState(
    scope: TenantScope,
    input: Parameters<DispatchRepository["advanceDispatchState"]>[1]
  ) {
    return this.dispatch.advanceDispatchState(scope, input);
  }

  acquireOrderLock(
    scope: TenantScope,
    orderId: number,
    usuario: string,
    expirationMinutes = 5
  ) {
    return this.dispatch.acquireOrderLock(
      scope,
      orderId,
      usuario,
      expirationMinutes
    );
  }

  releaseOrderLock(scope: TenantScope, orderId: number, usuario?: string) {
    return this.dispatch.releaseOrderLock(scope, orderId, usuario);
  }

  registerIdempotentTx(
    scope: TenantScope,
    txId: string,
    accion: string,
    detalle = ""
  ) {
    return this.operations.registerIdempotentTx(scope, txId, accion, detalle);
  }

  registerShiftClosure(
    scope: TenantScope,
    input: Parameters<OrderOperationsRepository["registerShiftClosure"]>[1]
  ) {
    return this.operations.registerShiftClosure(scope, input);
  }

  createFullPlan(
    scope: TenantScope,
    input: Parameters<OrderOperationsRepository["createFullPlan"]>[1]
  ) {
    return this.operations.createFullPlan(scope, input);
  }

  createFactoryPlan(
    scope: TenantScope,
    input: Parameters<OrderOperationsRepository["createFactoryPlan"]>[1]
  ) {
    return this.operations.createFactoryPlan(scope, input);
  }
}
