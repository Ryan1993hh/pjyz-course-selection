# 浦江一中拓展课选课管理系统

Cloudflare Pages + D1 部署的选课 / 教师端 / 管理后台。

## 线上入口

| 页面 | 路径 |
|------|------|
| 统一登录 | `/denglu` |
| 选课（班主任） | `/xuanke` |
| 教师端 | `/jiaoshi` |
| 管理后台 | `/admin` |

默认管理员：`admin` / `123456`（上线后请立即修改密码）

## 目录说明（部署相关）

```
public/          # 静态前端（Pages 输出目录）
functions/api/   # Cloudflare Pages Functions（/api/*）
wrangler.toml    # Pages 项目名 + D1 绑定
package.json     # Functions 依赖（xlsx / mammoth）
backend/         # 可选：本地 Express 开发（不上线必需）
```

## Cloudflare Pages 配置

- **Framework preset**: None  
- **Build command**: （留空）  
- **Build output directory**: `public`  
- **Root directory**: `/`  
- **D1 binding**: 名称 `DB` → 数据库 `pjyz-database`

## 本地开发

```bash
npm install
npm run cf:dev
# http://127.0.0.1:8788
```

## 默认账号

- 账号：`admin`
- 密码：`123456`
