# Canvas课程过滤修复 - 完整文档

## 问题描述

1. **侧边栏课程不全** - 某些Canvas课程没有在侧边栏显示
2. **HW1-6等作业编号被误认为课程** - 作业编号不应该作为课程类别
3. **课程代码格式不匹配** - 需要支持 `XXX Y111` 和 `XXX 111Y` 等多种格式

## 解决方案

### 1. 改进课程代码提取逻辑 ✅

**文件**: `app/static/app.js`

**支持的格式**:
- `XXX Y111: Course Name` → 提取 `XXX Y111`
- `XXX 111Y: Course Name` → 提取 `XXX 111Y`
- `[Canvas] XXX Y111: Assignment` → 提取 `XXX Y111`
- `XXX Y111 - Assignment` → 提取 `XXX Y111`
- `DPI 851M`, `EDU H12X`, `EDU T564A` 等

**过滤规则**:
- ❌ 排除 `HW 1`, `HW 2`, `HW 3` 等作业编号
- ❌ 排除 `HOMEWORK 1`, `HOMEWORK 2` 等
- ✅ 保留真实的课程代码

**实现代码**:
```javascript
function extractCourseCode(title) {
    // Remove source prefix like [Canvas], [Harvard Canvas], etc.
    let cleanTitle = title.replace(/^\[[^\]]+\]\s*/, '');

    // Pattern 1: XXX Y111, XXX 111Y, XXX 851M
    const pattern1 = cleanTitle.match(/^([A-Z]{2,4}\s+[A-Z]?\d+[A-Z]?)/i);
    if (pattern1) {
        const code = pattern1[1].toUpperCase();
        // Filter out HW 1, HW 2, etc.
        if (!code.match(/^HW\s+\d+$/i) && !code.match(/^HOMEWORK\s+\d+$/i)) {
            return code;
        }
    }

    // Pattern 2: Course code followed by colon
    const pattern2 = cleanTitle.match(/^([A-Z]{2,4}\s+[A-Z]?\d+[A-Z]?):/i);
    if (pattern2) {
        const code = pattern2[1].toUpperCase();
        if (!code.match(/^HW\s+\d+$/i)) {
            return code;
        }
    }

    // Pattern 3: Course code followed by dash
    const pattern3 = cleanTitle.match(/^([A-Z]{2,4}\s+[A-Z]?\d+[A-Z]?)\s*[-–—]/i);
    if (pattern3) {
        const code = pattern3[1].toUpperCase();
        if (!code.match(/^HW\s+\d+$/i)) {
            return code;
        }
    }

    return null;
}
```

### 2. 正确识别Canvas事件来源 ✅

**文件**: `services/google_calendar.py`

**问题**: 之前所有事件都标记为 `source: 'Google'`

**解决**: 从事件标题前缀识别来源
- `[Harvard Canvas]` → `source: 'Harvard Canvas'`
- `[MIT Canvas]` → `source: 'MIT Canvas'`
- `[Canvas]` → `source: 'Canvas'`
- 其他 → `source: 'Google'`

**实现代码**:
```python
title = event.get('summary', 'No Title')

# Detect event source from title prefix
source = 'Google'  # Default
if title.startswith('[Harvard Canvas]'):
    source = 'Harvard Canvas'
elif title.startswith('[MIT Canvas]'):
    source = 'MIT Canvas'
elif title.startswith('[Canvas]'):
    source = 'Canvas'
elif title.startswith('['):
    match = re.match(r'^\[([^\]]+)\]', title)
    if match:
        source = match.group(1)
```

### 3. 使用特定的Canvas源名称 ✅

**文件**: `services/ingestion.py`

**之前**: 所有Canvas源都使用 `"Canvas"` 标记
**现在**: 使用配置中的具体名称 (`"Harvard Canvas"`, `"MIT Canvas"`)

**修改**:
```python
# Before
source_name="Canvas",  # 固定值

# After
source_name=source.name,  # "Harvard Canvas", "MIT Canvas"
```

### 4. 配置文件示例

**文件**: `config.yaml`

```yaml
canvas_sources:
  - name: "Harvard Canvas"
    url: "https://canvas.harvard.edu/feeds/calendars/user_xxx.ics"
  - name: "MIT Canvas"
    url: "https://canvas.mit.edu/feeds/calendars/user_yyy.ics"
```

## 测试示例

### 示例1: Harvard课程
```
标题: [Harvard Canvas] DPI 851M: Data Science Project
提取: DPI 851M
显示: ✅ 在侧边栏显示为 "DPI 851M"
```

### 示例2: MIT课程
```
标题: [MIT Canvas] EDU T564A: Learning Analytics
提取: EDU T564A
显示: ✅ 在侧边栏显示为 "EDU T564A"
```

### 示例3: 课程作业（带编号）
```
标题: [Harvard Canvas] DPI 851M: HW 1 - Data Cleaning
提取: DPI 851M
显示: ✅ 在侧边栏显示为 "DPI 851M" (不是 "HW 1")
```

### 示例4: 作业编号（误识别情况）
```
标题: HW 3: Assignment
提取: null
显示: ❌ 不在侧边栏显示 (正确过滤)
```

### 示例5: 不同格式的课程代码
```
标题: [Canvas] CS 111A: Introduction to Programming
提取: CS 111A
显示: ✅ 在侧边栏显示为 "CS 111A"

标题: [Canvas] MATH A101: Calculus
提取: MATH A101
显示: ✅ 在侧边栏显示为 "MATH A101"

标题: [Canvas] PHYS 101B: Physics Lab
提取: PHYS 101B
显示: ✅ 在侧边栏显示为 "PHYS 101B"
```

## 使用方法

### 1. 同步Canvas课程

点击"Sync Canvas"按钮，系统会：
1. 从Harvard Canvas和MIT Canvas获取所有事件
2. 添加 `[Harvard Canvas]` 或 `[MIT Canvas]` 前缀
3. 导入到Google Calendar
4. 前端自动提取课程代码并显示在侧边栏

### 2. 查看课程过滤器

侧边栏"Course Filters"区域会显示：
- ✅ `DPI 851M`
- ✅ `EDU T564A`
- ✅ `EDU H12X`
- ❌ ~~`HW 1`~~ (已过滤)
- ❌ ~~`HW 2`~~ (已过滤)

### 3. 过滤课程

- **选中复选框**: 显示该课程的所有事件
- **取消选中**: 隐藏该课程的事件
- **Select All / Deselect All**: 批量操作

## 调试

如果课程没有显示，打开浏览器Console (F12)，查看：

```javascript
// 查看所有事件标题
events.forEach(e => console.log(e.title));

// 查看提取的课程代码
events.forEach(e => console.log(extractCourseCode(e.title)));

// 查看所有课程
console.log('All courses:', Array.from(allCourses));
```

## 修复的文件

1. ✅ `app/static/app.js` - 改进课程代码提取
2. ✅ `services/google_calendar.py` - 识别事件来源
3. ✅ `services/ingestion.py` - 使用特定Canvas源名称

## 预期效果

### 侧边栏显示示例:
```
Course Filters
□ Select All / Deselect All

☑ DPI 851M         (Harvard Canvas)
☑ EDU T564A        (Harvard Canvas)
☑ EDU H12X         (MIT Canvas)
☑ CS 101A          (MIT Canvas)
☑ MATH 202         (Google Calendar - 自己添加)
```

### 日历颜色:
- 🔴 Harvard Canvas events (Crimson Red)
- 🔴 MIT Canvas events (MIT Red)
- 🔵 Google Calendar events (Google Blue)

## 下一步

服务器应该已经自动重新加载。请：

1. **刷新浏览器** (Cmd+Shift+R / Ctrl+Shift+R)
2. **点击 "Sync Canvas"** 按钮重新同步
3. **检查侧边栏** - 应该显示所有课程（不含HW编号）
4. **查看控制台** - 如有问题，查看调试信息

---

**最后更新**: 2025-10-24
**状态**: ✅ 已完成
