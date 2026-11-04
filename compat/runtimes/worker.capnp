# The worker of the check, as workerd runs it. The address of the socket is given on the command line, and the worker module is
# the bundle that check.ts writes. The compatibility date is the one the packages promise to work from, with no compatibility
# flags, so the worker has none of the modules of Node.js, and it may make no call to the network.
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "main", worker = .worker)],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "main")],
);

const worker :Workerd.Worker = (
  modules = [(name = "worker", esModule = embed ".dist/worker.js")],
  compatibilityDate = "2025-01-01",
);
