# 浦江一中拓展课选课管理系统

完整的前后端分离选课管理系统，支持课程管理、选课结果管理、用户管理与前端选课。

## 技术栈
- 前端：HTML + CSS + JavaScript（响应式）
- 后端：Node.js + Express
- 数据库：SQLite（better-sqlite3）
- 文件解析：xlsx（Excel）、mammoth（docx）

## 目录结构
```
选课管理系统/
├── package.json
├── README.md
├── backend/
│   ├── server.js        # 入口，启动 Express
│   ├── db.js            # 数据库初始化与辅助函数
│   ├── auth.js          # Token 鉴权中间件
│   └── routes/
│       ├── auth.js      # 登录接口
│       ├── courses.js   # 课程管理接口
│       ├── selections.js# 选课结果接口
│       └── users.js     # 用户管理接口
├── frontend/
│   ├── index.html       # 登录 + 选课页面（教师/学生入口）
│   ├── admin.html       # 后台管理（侧边栏切换三模块）
│   ├── css/
│   └── js/
└── database/
    └── app.db           # SQLite 数据库文件（首次运行自动创建）
```

## 快速开始

### 1. 安装依赖
```bash
cd 选课管理系统
npm install
```

### 2. 启动服务
```bash
npm start
```
或
```bash
node backend/server.js
```

### 3. 访问页面
- 前端登录入口：http://localhost:3000/
- 选课页面：http://localhost:3000/xuanke.html
- 后台管理入口：http://localhost:3000/admin.html

### 4. 默认账号
- 管理员：`admin` / `123456` → 进入后台管理
- 用户/教师：`123456` / `123456` → 进入选课页面

系统首次启动时会自动创建上述账号；若已存在旧账号（如 `admin/admin123`）会自动迁移为新的默认密码。

## 部署上线（GitHub + Render + Cloudflare）

整体架构：**Render 单个 Web Service 同时托管 API 与前端静态资源**，前端用相对路径 `/api/...` 调用后端，无需配置 CORS。GitHub 用于托管代码并触发自动部署，Cloudflare 用于 DNS / 自定义域名。

### 第 1 步：把代码推到 GitHub
1. 在 GitHub 新建一个空仓库（例如 `pjyz-course-selection`），不要勾选 README / .gitignore / license。
2. 在项目根目录执行：
   ```bash
   git init
   git add .
   git commit -m "浦江一中选课系统初始提交"
   git branch -M main
   git remote add origin https://github.com/你的用户名/pjyz-course-selection.git
   git push -u origin main
   ```
   注意：`.gitignore` 已排除 `node_modules/` 与 `database/*.db`，不会把依赖和数据库推上去。

### 第 2 步：在 Render 创建 Web Service
1. 注册 / 登录 https://render.com（可用 GitHub 账号登录）。
2. 点 **New +** → **Web Service** → 选 **Build and deploy from a Git repository** → 授权并选择刚才的 GitHub 仓库。
3. 填写配置（仓库里已有 `render.yaml`，也可在网页上手动填写）：
   - **Name**：`pjyz-course-selection`（任意，会成为子域名一部分）
   - **Runtime**：`Node`
   - **Region**：选最近的（如 Singapore）
   - **Branch**：`main`
   - **Build Command**：`npm install`
   - **Start Command**：`npm start`
   - **Plan**：`Free`（免费）或 `Starter`（推荐，支持持久磁盘）
4. 展开 **Advanced**，设置 **Health Check Path** 为 `/api/health`。
5. 点 **Create Web Service**。Render 会自动 `npm install` 然后 `npm start`，几分钟后可得到一个 `https://pjyz-course-selection.onrender.com` 这样的地址。
6. 部署完成后，浏览器访问该地址：
   - 登录页：`https://你的服务名.onrender.com/`
   - 后台：`https://你的服务名.onrender.com/admin.html`
   - 健康检查：`https://你的服务名.onrender.com/api/health`

### 第 3 步（重要）：数据持久化
- **免费方案**：Render 免费层文件系统是临时的，**每次重新部署或重启，SQLite 数据会丢失**（账号会自动重建，但课程/选课记录会清空）。适合演示和短期使用。
- **持久化方案（推荐用于实际生产）**：把 `render.yaml` 里 `plan: free` 改成 `plan: starter`，并取消 `disk:` 段的注释：
  ```yaml
  plan: starter
  disk:
    name: pjyz-data
    mountPath: /var/data
    sizeGB: 1
  ```
  后端 `db.js` 会自动检测 `/var/data` 并把数据库写入持久磁盘（约 $7/月 Web Service + $1/月 磁盘）。重新部署后数据保留。

### 第 4 步（可选）：用 Cloudflare 绑定自定义域名
1. 在 Cloudflare 添加你的域名（如 `pjyz.edu.cn`），把 Cloudflare 给出的两个 NS 替换掉域名注册商的 NS。
2. 进入 Cloudflare 的 **DNS** → 添加记录：
   - 类型：`CNAME`
   - 名称：`xuanke`（或 `@` 表示根域）
   - 目标：`pjyz-course-selection.onrender.com`（你的 Render 服务地址）
   - 代理状态：开启橙色云朵
3. 进入 Render 的 Web Service → **Settings** → **Custom Domains** → 添加 `xuanke.你的域名`，Render 会自动签发 HTTPS 证书。
4. 等待几分钟，即可通过 `https://xuanke.你的域名` 访问系统。
5. （可选）在 Cloudflare **SSL/TLS** 设置为 `Full` 模式，并在 **Speed → Optimization** 关闭 Auto Minify 对 HTML 的压缩（避免影响页面脚本）。

### 部署后验证清单
- [ ] 打开网站根路径，能看到登录页
- [ ] 用 `admin / 123456` 登录 → 自动跳转 `admin.html`，左侧能看到课程管理 / 选课结果 / 用户管理
- [ ] 用 `123456 / 123456` 登录 → 自动跳转 `xuanke.html`，能上传名单、选课、导出
- [ ] 在 xuanke.html 导出 Excel 后，到 admin.html 的「选课结果」筛选该班级能看到刚提交的数据
- [ ] 访问 `/api/health` 返回 `{"status":"ok",...}`

## 功能说明

### 前端选课页面 (/)
1. 登录（账号密码验证）
2. 选课表格展示（六年级/七年级名额切换）
3. 上传学生名单 Excel
4. 点击名额按钮弹出 8 列名字网格选课
5. 上传并下载 Excel（选课结果同步到后台）

### 后台管理 (/admin.html)
侧边栏切换三个模块：
- **课程管理**：拖拽上传 xlsx/xls/docx → 自动解析 → 行内编辑表格 → 确认保存
- **选课结果**：按年级/班级/课程筛选 → 编辑换课 → 导出 Excel
- **用户管理**：添加/编辑/删除用户，管理 admin 与 teacher 角色

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login | 登录验证 |
| GET  | /api/courses | 获取所有课程 |
| POST | /api/courses/upload | 上传并解析课程文件 |
| PUT  | /api/courses | 批量保存课程 |
| DELETE | /api/courses/:id | 删除单门课程 |
| POST | /api/selections | 上传选课结果并返回 Excel |
| GET  | /api/selections | 按条件查询选课结果 |
| PUT  | /api/selections/:id | 修改选课记录（换课） |
| GET  | /api/selections/export | 导出 Excel |
| GET  | /api/classes | 获取班级列表 |
| GET  | /api/users | 获取用户列表 |
| POST | /api/users | 添加用户 |
| PUT  | /api/users/:id | 修改用户 |
| DELETE | /api/users/:id | 删除用户 |

## 数据库表结构

### courses 课程表
id, category, name, description, teacher, location, requirement, limit_grade6, limit_grade7

### selections 选课结果表
id, grade, class_name, student_name, course_id, course_name, upload_time

### users 用户表
id, username, password, role(admin/teacher)
