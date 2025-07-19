import ngx from "jsr:@char/ngx@0.2";

const domain = "x-burrow-20250718.tmp.bun.how";
export const config = ngx("", [
  ngx("map $http_upgrade $connection_upgrade", ["default upgrade", "'' close"]),
  ngx("server", [
    ...ngx.listen(),
    ...ngx.letsEncrypt(domain),
    ngx.serverName(domain),
    ngx("location /", [
      "client_max_body_size 1G",
      "proxy_pass http://127.0.0.1:3000",
      "proxy_http_version 1.1",
      "proxy_set_header Upgrade $http_upgrade",
      "proxy_set_header Connection $connection_upgrade",
      "proxy_set_header Host $host",
      "proxy_read_timeout 300s",
    ]),
  ]),
  ngx("server", [
    "# wildcard server for did:webs",
    ...ngx.listen(),
    ...ngx.letsEncrypt(domain),
    ngx.serverName("*." + domain),
    ngx("location /", ["proxy_pass http://127.0.0.1:3000", "proxy_set_header Host $host"]),
  ]),
]);

if (import.meta.main) {
  console.log(config.build());
}
