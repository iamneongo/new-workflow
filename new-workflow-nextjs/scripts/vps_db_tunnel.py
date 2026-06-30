import argparse
import select
import socket
import socketserver
import sys

import paramiko


class TunnelHandler(socketserver.BaseRequestHandler):
    ssh_transport = None
    remote_host = None
    remote_port = None

    def handle(self):
        try:
            channel = self.ssh_transport.open_channel(
                "direct-tcpip",
                (self.remote_host, self.remote_port),
                self.request.getpeername(),
            )
        except Exception as exc:
            print(f"channel open failed: {exc}", file=sys.stderr, flush=True)
            return

        if channel is None:
            print("channel open failed: no channel returned", file=sys.stderr, flush=True)
            return

        try:
            while True:
                readers, _, _ = select.select([self.request, channel], [], [])
                if self.request in readers:
                    data = self.request.recv(4096)
                    if not data:
                        break
                    channel.sendall(data)
                if channel in readers:
                    data = channel.recv(4096)
                    if not data:
                        break
                    self.request.sendall(data)
        finally:
            channel.close()
            self.request.close()


class ThreadedTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ssh-host", required=True)
    parser.add_argument("--ssh-port", type=int, required=True)
    parser.add_argument("--ssh-user", required=True)
    parser.add_argument("--ssh-password", required=True)
    parser.add_argument("--listen-host", default="127.0.0.1")
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--remote-host", default="127.0.0.1")
    parser.add_argument("--remote-port", type=int, required=True)
    args = parser.parse_args()

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        args.ssh_host,
        port=args.ssh_port,
        username=args.ssh_user,
        password=args.ssh_password,
        timeout=20,
    )

    transport = client.get_transport()
    if transport is None:
        raise RuntimeError("SSH transport is not available")

    handler = TunnelHandler
    handler.ssh_transport = transport
    handler.remote_host = args.remote_host
    handler.remote_port = args.remote_port

    server = ThreadedTCPServer((args.listen_host, args.listen_port), handler)
    print(
        f"tunnel ready: {args.listen_host}:{args.listen_port} -> {args.remote_host}:{args.remote_port} via {args.ssh_host}:{args.ssh_port}",
        flush=True,
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
        client.close()


if __name__ == "__main__":
    main()
