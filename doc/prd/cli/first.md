# 需求

> 范围:Bastion CLI

## 目的

棒球队员自训登记，数据库读写
```sh
bastion report write --name [name] --date [date] --content [content] --reflection [reflection]
bastion report read --name [name] --date [date]
```

## 技术栈

- Go CLI(Kong)
- SQLite

## 表格设计

包含如下表格和字段

### 队员表

- 姓名
- 背号
- 打击手（左/右）可多选
- 投球手（左/右）可多选
- 守备位置（投手/接手/内野/外野）可多选

### 自训登记表

- 姓名
- 日期
- 内容
- 感想
