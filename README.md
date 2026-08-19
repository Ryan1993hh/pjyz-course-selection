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

### 4. 默认管理员账号
- 账号：`admin`
- 密码：`admin123`

系统首次启动时会自动创建该账号。

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
