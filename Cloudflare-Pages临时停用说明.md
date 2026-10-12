# Cloudflare Pages 临时停用说明

项目：`pjyz-course-selection`  
控制台：https://dash.cloudflare.com/b5ce183feb77c23aa5807dbbfa600692/pages/view/pjyz-course-selection  

适用场景：免费 `*.pages.dev` 已上线，想让**外人打不开业务页**，但不一定删除项目。

> Cloudflare Pages **没有「暂停运行」开关**。正式域名会一直提供当前部署内容。

---

## 推荐方案：部署「维护中」页面（国内最稳）

Zero Trust / Access 控制台在国内经常很卡。优先用本机 Wrangler 覆盖正式站。

### 1. 生成本地维护页

在本机 PowerShell 执行：

```powershell
$dir = "C:\temp\pages-offline"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
@'
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>系统维护中</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:sans-serif;background:#f5f5f5;color:#333}
  </style>
</head>
<body>
  <main style="text-align:center">
    <h1>系统维护中</h1>
    <p>选课系统暂时停用，请稍后再试。</p>
  </main>
</body>
</html>
'@ | Set-Content -Path "$dir\index.html" -Encoding UTF8
```

### 2. 部署覆盖正式站

```powershell
npx wrangler login
npx wrangler pages deploy "C:\temp\pages-offline" --project-name=pjyz-course-selection --branch=main
```

完成后访问 `*.pages.dev`，应只看到「系统维护中」。

### 3. 关掉自动部署（防止 GitHub 推送盖回去）

1. 打开 Pages 项目 → **Settings** → **Build**
2. 任选其一：
   - **Branch control** → 编辑 → 关闭 **Automatic deployments**
   - 或顶部 Git repository 点红色 **Disconnect**（断开 GitHub）

---

## 恢复正式站点

### 方式 A：重新部署本地 `public`

```powershell
cd E:\HTML\选课管理系统2
npx wrangler pages deploy public --project-name=pjyz-course-selection --branch=main
```

### 方式 B：重新打开自动部署后推送 GitHub

1. Build 设置里重新 **Enable Automatic deployments**（或重新 Connect 仓库）
2. 向 `main` 推送一次，触发正式部署

---

## 备选：Cloudflare Access（登录墙）

效果：未授权邮箱无法打开正式站。  
注意：Zero Trust 控制台常卡；Pages 设置里的 **Preview access** **只锁预览链接，不锁正式站**。

### 操作路径

1. 打开 https://one.dash.cloudflare.com/
2. **Access controls** → **Applications** → **Add an application**
3. 选 **Self-hosted**
4. Public hostname 填正式域名，例如：`pjyz-course-selection.pages.dev`
5. Policy：Action = **Allow**，Include → **Emails** → 填你的邮箱
6. 保存

用无痕窗口打开正式地址验证：应出现 Cloudflare 登录页。

要重新对外开放：删除或关闭该 Access 应用即可。

---

## 若要彻底删除 Pages 项目

GitHub 仓库不会受影响，只是 Cloudflare 不再托管。

### 网页删除失败时

若提示「部署太多无法直接删除」（`https://cfl.re/3CXesIn`），需先用 Wrangler 清历史部署：

```powershell
$project = "pjyz-course-selection"
$prodId = ""
while ($true) {
  $json = npx wrangler pages deployment list --project-name $project --json | Out-String
  $list = $json | ConvertFrom-Json
  if (-not $list -or $list.Count -eq 0) { Write-Host "没有更多部署"; break }
  $ids = @($list | ForEach-Object { $_.Id })
  $toDelete = $ids | Where-Object { $_ -and $_ -ne $prodId }
  if (-not $toDelete -or $toDelete.Count -eq 0) {
    Write-Host "清理完成。生产部署: $prodId"
    break
  }
  Write-Host "本轮删除 $($toDelete.Count) 个部署..."
  foreach ($id in $toDelete) {
    $out = npx wrangler pages deployment delete $id --project-name $project --force 2>&1 | Out-String
    if ($out -match "Successfully deleted") {
      Write-Host "已删除 $id"
    } elseif ($out -match "active production deployment") {
      $prodId = $id
      Write-Host "跳过生产部署 $id"
    } else {
      Write-Host $out
    }
  }
}

npx wrangler pages project delete pjyz-course-selection --yes
```

或清理后再回控制台 **Settings → General → Delete**，确认框按弹窗要求原样输入项目名。

---

## 怎么选

| 目标 | 做法 |
|------|------|
| 外人打不开业务（推荐） | 部署维护页 + 关自动部署 |
| 登录后自己还能进 | Zero Trust Access（控制台可能很卡） |
| 不再随 GitHub 更新 | 关 Automatic deployments / Disconnect |
| 完全下线托管 | 清部署后删除 Pages 项目 |

---

## 相关文件

- 云服务器代码同步与重启：`更新到云服务器的命令语句.md`
- GitHub 仓库：`https://github.com/Ryan1993hh/pjyz-course-selection`
