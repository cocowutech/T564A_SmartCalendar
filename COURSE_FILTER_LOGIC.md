# Course & Event Filter Logic - 完整说明

## 修复内容

### 1. ✅ All-Day事件课程提取
**问题**: `[DPI 851M]` 格式的all-day事件没有被识别为课程

**解决**: 添加特殊pattern识别 `[COURSE_CODE]` 格式
```javascript
// Special pattern for all-day events: "[DPI 851M]" format
const allDayPattern = title.match(/^\[([A-Z]{2,4}\s+[A-Z]?\d+[A-Z]?)\]$/i);
if (allDayPattern) {
    return allDayPattern[1].toUpperCase(); // "DPI 851M"
}
```

### 2. ✅ Filter标题更新
**更改**: "Course Filters" → "Course & Event Filters"

**原因**: 更准确地描述功能 - 过滤课程和事件

### 3. ✅ HW作业显示逻辑
**规则**:
- HW编号 **不** 作为filter选项显示
- HW作业 **仍然** 在日历上显示（作为所属课程的一部分）

## 工作原理

### 示例1: 课程作业（带HW编号）
```
事件标题: [Harvard Canvas] DPI 851M: HW 1 - Data Cleaning
课程提取: "DPI 851M"
Filter显示: ✅ "DPI 851M" (不是 "HW 1")
日历显示: ✅ 当"DPI 851M"被选中时显示
```

**为什么?**
1. `extractCourseCode()` 从完整标题提取 `DPI 851M`
2. `HW 1` 被识别为作业编号，不返回为课程代码
3. 事件归属于 `DPI 851M` 课程
4. 当用户选择 `DPI 851M` filter时，这个作业会显示

### 示例2: All-Day课程事件
```
事件标题: [DPI 851M]
课程提取: "DPI 851M"
Filter显示: ✅ "DPI 851M"
日历显示: ✅ 在No-Time Events区域显示
```

### 示例3: 独立的HW编号（不应该出现，但处理了）
```
事件标题: HW 3: Assignment
课程提取: null (过滤掉)
Filter显示: ❌ 不显示
日历显示: ✅ 总是显示（因为没有课程代码）
```

### 示例4: 普通课程事件
```
事件标题: [MIT Canvas] CS 111A: Lecture 5
课程提取: "CS 111A"
Filter显示: ✅ "CS 111A"
日历显示: ✅ 当"CS 111A"被选中时显示
```

## 课程代码提取规则

### 支持的格式:
```javascript
// All-day events
"[DPI 851M]"                              → "DPI 851M" ✅

// With Canvas prefix
"[Harvard Canvas] DPI 851M: Assignment"   → "DPI 851M" ✅
"[MIT Canvas] CS 111A: Lecture"           → "CS 111A" ✅

// With colon
"EDU T564A: Learning Analytics"           → "EDU T564A" ✅
"CS 111A: Homework"                       → "CS 111A" ✅

// With dash
"MATH 202 - Problem Set"                  → "MATH 202" ✅
"PHYS 101B - Lab"                         → "PHYS 101B" ✅

// Direct format
"DPI 851M"                                → "DPI 851M" ✅
"EDU H12X"                                → "EDU H12X" ✅
```

### 过滤的格式:
```javascript
// Homework numbers (not courses)
"HW 1"                                    → null ❌
"HW 2"                                    → null ❌
"HOMEWORK 3"                              → null ❌

// But HW in context is OK:
"[Canvas] DPI 851M: HW 1"                 → "DPI 851M" ✅ (extracts course)
```

## Filter逻辑

### getFilteredEvents() 函数:
```javascript
function getFilteredEvents() {
    if (courseFilters.size === 0) {
        return events; // 没有选中任何filter = 显示所有
    }

    return events.filter(event => {
        const code = extractCourseCode(event.title);
        if (!code) return true; // 没有课程代码的事件总是显示
        return courseFilters.has(code); // 有课程代码的事件根据filter决定
    });
}
```

### 行为:
1. **没有选中任何课程**: 显示所有事件
2. **选中某些课程**:
   - 显示这些课程的所有事件（包括作业）
   - 显示没有课程代码的事件（如个人事件）
   - 隐藏其他课程的事件

## 用户体验

### Sidebar显示:
```
Course & Event Filters
☐ All / None

☑ DPI 851M          (15 events)
☑ EDU T564A         (8 events)
☐ CS 111A           (12 events)
☑ MATH 202          (6 events)
```

**不会显示**:
- ❌ HW 1
- ❌ HW 2
- ❌ HOMEWORK 3

### Calendar显示 (DPI 851M选中):
```
Monday
  9:00 AM - [Harvard Canvas] DPI 851M: Lecture 1       ✅
 11:00 AM - [Harvard Canvas] DPI 851M: HW 1 Due       ✅
  2:00 PM - [Harvard Canvas] DPI 851M: Office Hours   ✅

No-Time Events
  [DPI 851M]                                           ✅
```

### Calendar显示 (DPI 851M未选中):
```
Monday
  (DPI 851M events hidden)                             ❌

  9:00 AM - Personal Meeting                          ✅ (no course code)
  3:00 PM - [MIT Canvas] CS 111A: Lecture             ✅ (if CS 111A selected)

No-Time Events
  [DPI 851M]                                          ❌ (hidden)
```

## 测试场景

### 测试1: All-Day事件提取
```
给定: Event with title "[DPI 851M]"
期望: Filter显示 "DPI 851M"
结果: ✅ Pass
```

### 测试2: HW作业过滤
```
给定: Event with title "[Harvard Canvas] DPI 851M: HW 1"
期望:
  - Filter显示 "DPI 851M" (不是 "HW 1")
  - 当"DPI 851M"选中时，事件在日历显示
结果: ✅ Pass
```

### 测试3: 多种课程格式
```
给定: Events with titles:
  - "CS 111A: Lecture"
  - "MATH A101: Problem Set"
  - "PHYS 101B - Lab"
期望: Filter显示 "CS 111A", "MATH A101", "PHYS 101B"
结果: ✅ Pass
```

### 测试4: 独立HW编号
```
给定: Event with title "HW 3"
期望:
  - Filter不显示 "HW 3"
  - 事件总是显示（没有课程代码）
结果: ✅ Pass
```

## 调试命令

在浏览器Console中运行:

```javascript
// 查看所有事件标题
events.forEach(e => console.log(e.title));

// 查看课程提取结果
events.forEach(e => {
    const code = extractCourseCode(e.title);
    console.log(`"${e.title}" → "${code}"`);
});

// 查看当前filter的课程
console.log('Courses in filter:', Array.from(allCourses));

// 查看当前选中的filter
console.log('Active filters:', Array.from(courseFilters));

// 测试特定标题
const testTitles = [
    "[DPI 851M]",
    "[Harvard Canvas] DPI 851M: HW 1",
    "CS 111A: Lecture",
    "HW 3"
];
testTitles.forEach(title => {
    console.log(`"${title}" → "${extractCourseCode(title)}"`);
});
```

## 预期结果

### Filter区域:
```
Course & Event Filters
☐ All / None

课程列表（不含HW编号）:
☑ DPI 851M
☑ EDU T564A
☑ EDU H12X
☑ CS 111A
☑ MATH 202
☑ PHYS 101B
```

### 日历显示:
- ✅ 所有选中课程的事件（包括作业）
- ✅ 所有没有课程代码的个人事件
- ✅ All-day课程事件（如 `[DPI 851M]`）
- ❌ 未选中课程的事件

---

**最后更新**: 2025-10-24
**状态**: ✅ 已完成并测试
