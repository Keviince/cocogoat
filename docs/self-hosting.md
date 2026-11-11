# 自有服务器部署

网页与同步接口打包在同一个容器中，使用 Docker Compose 启动，不需要数据库。原椰羊账号、OneDrive、第三方验证码和同步接口已移除；未登录时仍可在本机使用成就功能。

## 首次启动

服务器需要 Docker Engine 和 Docker Compose v2。运行以下命令，子模块也需要下载：

```sh
git clone --recurse-submodules https://github.com/Keviince/cocogoat.git
cd cocogoat
docker compose build sync
docker compose run --rm --no-deps sync node admin.mjs create 123456789
docker compose up -d
```

创建账号时输入密码，终端不会显示密码，长度要求为 10–128 个字符。没有默认账号、默认密码或公开注册入口。`123456789` 可以替换为自己的 UID 或账户名；UID 只是本站的登录名，不会验证或登录米哈游账号。账户名支持 3–64 位字母、数字、下划线、点和横线，不区分大小写。

本机访问 `http://localhost:8080`，直接进入成就列表。右上角设置 → 我的服务器，填写创建的账号和密码即可。部署在远程服务器时，使用下方域名 HTTPS 方式访问；默认端口只监听服务器本机。

## 域名与 HTTPS

先将域名解析到服务器，并开放 80、443 端口。复制配置文件：

```sh
cp .env.selfhost.example .env.selfhost
```

将其中的 `SITE_DOMAIN` 改为自己的域名，例如 `achievements.example.com`，不要带 `https://`。然后启动内置的 Caddy：

```sh
docker compose --env-file .env.selfhost --profile https up -d --build
```

访问 `https://achievements.example.com`，设置里的服务器地址会默认填入当前域名。Caddy 自动申请和续期证书。之后管理这套部署时，Compose 命令继续使用相同的 `--env-file .env.selfhost --profile https` 参数。

已有反向代理也可以只运行 `sync`，把域名反向代理到 `127.0.0.1:8080`，保留原始 Host。服务器地址必须是 HTTPS；只允许 localhost、127.0.0.1 和 ::1 使用 HTTP。

如果继续使用 [GitHub Pages 网页](https://keviince.github.io/cocogoat/)，在“我的服务器”里填入自己的 HTTPS 地址。默认允许 `https://keviince.github.io` 跨域访问；其他网页来源需要加入 `ALLOWED_ORIGINS`，多个来源用逗号分隔，只填协议和域名，不带路径。同域网页自动允许。

## 创建更多账号、重置密码

文件存储只运行一个 `sync` 实例。管理账号时先停止同步服务，避免管理命令与服务同时修改账号文件：

```sh
docker compose stop sync
docker compose run --rm --no-deps sync node admin.mjs create another-user
docker compose up -d
```

重置已有账号密码：

```sh
docker compose stop sync
docker compose run --rm --no-deps sync node admin.mjs password 123456789
docker compose up -d
```

重置密码会撤销该账号的全部登录会话，成就数据保留。每个服务端账号拥有独立的数据文件；一个账号可以保存多个游戏角色的成就资料。

## 同步规则与迁移

- 成就先保存到浏览器，修改后约 1 秒提交；在线且网页可见时每 30 秒检查一次，网络恢复后重试。登录会话有效期 30 天。
- 首次登录会同步本机已有资料。退出登录保留本机资料；换服务端账号前，可先导出备份并按需清除本机数据，避免把同一份资料上传到另一个账号。
- 两台设备修改同一份资料时，使用版本号检测冲突，不会静默覆盖。设置中可明确选择冲突时保留本地，或恢复完整服务器快照。发生冲突前仍会同步其他未冲突的资料。
- “清除本地数据”会先退出登录，只清除本机成就和设置，保留服务器记录。
- 原第三方同步配置不再读取，既有本机成就保留。切换网页域名后，浏览器不会共享原域名的本地资料；先在旧网页导出成就文件，再到新网页的成就导入功能导入，最后登录自己的服务器。全部本地数据 ZIP 可作为额外备份保留。

密码只用于登录，不存入浏览器；服务端保存随机盐加 scrypt 密码哈希。浏览器保存会话凭证，服务端只保存凭证哈希。登录接口有尝试频率限制。数据文件以临时文件写入、刷盘后替换，并保留上一份 `.bak`；损坏文件不会被当成空数据覆盖。

## 数据、备份与升级

数据保存在 Compose 命名卷 `cocogoat_sync_data`，容器内路径 `/data`：

- `accounts.json`：账号哈希与登录会话；
- `records-<账号哈希>.json`：该账号所有角色资料、设置及同步版本；
- `*.bak`：对应文件的上一份副本。

每次请求最多 2 MB，每个账号最多 16 MB，适用于少量个人成就数据。只支持单实例，不要增加 `sync` 副本数或让多台服务共享同一目录。

备份时先停止服务，再复制数据目录，保证文件来自同一时刻：

```sh
mkdir -p backups
docker compose stop sync
docker compose cp sync:/data ./backups/data
docker compose up -d
```

`./backups/data` 应使用新的空目录，备份后妥善保管，包括账号文件与 `.bak` 文件。恢复时停止服务，将整份备份复制回 `/data`，并保持文件归容器的 `node` 用户所有（UID/GID 1000）；可以用下方命令完成，备份放在当前目录的 `backups/data`：

```sh
docker compose stop sync
docker compose run --rm --no-deps --user root -v "$(pwd)/backups/data:/restore:ro" sync sh -c 'cp -a /restore/. /data/ && chown -R 1000:1000 /data'
docker compose up -d
```

恢复会覆盖同名文件；恢复前先保留当前数据的备份。恢复到已有卷时，先确认其中没有备份之外的额外账号文件，以免混入旧资料。

升级代码和镜像：

```sh
git pull --ff-only
git submodule update --init --recursive
docker compose up -d --build
```

升级会保留命名卷。不要使用 `docker compose down -v`，该选项会删除数据卷。Compose 的卷保留行为可参阅 [Docker 官方说明](https://docs.docker.com/reference/cli/docker/compose/up/)。线上实例使用构建时锁定的成就数据；仓库自动更新后，需要在服务器执行上述升级步骤才会加载新数据。

## 验证

`pnpm test:sync` 验证认证、账号隔离、会话撤销、持久化、冲突、离线重试和删除传播。仓库发布流程还会实际构建 Docker 镜像，创建测试账号，打开打包网页，写入数据后移除并重新创建容器，验证数据卷与会话仍有效。测试使用独立的 `cocogoat-container-test` 项目及临时卷，不操作实际部署。
