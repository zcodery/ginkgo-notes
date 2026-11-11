import type { Component } from 'vue'
import { GitBranch, Workflow, MessagesSquare, Waypoints, Boxes, Network, CalendarRange, PieChart } from 'lucide-vue-next'

export interface DiagramTemplate {
  id: string
  title: string
  desc: string
  icon: Component
  keywords: string[]
  code: string
}

/**
 * 图表模板库
 *
 * 全部是标准 Mermaid 语法 —— 落盘就是 ```mermaid 代码块，
 * GitHub、Typora、Obsidian 都能直接渲染，导出不丢。
 */
export const diagramTemplates: DiagramTemplate[] = [
  {
    id: 'er',
    title: 'ER 图',
    desc: '数据库表结构与实体关系',
    icon: GitBranch,
    keywords: ['er', 'erdiagram', '数据库', '实体', '表结构'],
    code: `erDiagram
    USER ||--o{ ORDER : "下单"
    ORDER ||--|{ ORDER_ITEM : "包含"
    PRODUCT ||--o{ ORDER_ITEM : "关联"

    USER {
        uuid id PK
        string email UK "登录邮箱"
        string nickname "昵称"
        datetime created_at
    }
    ORDER {
        uuid id PK
        uuid user_id FK
        decimal amount "订单金额"
        string status "待付款/已支付/已发货"
    }
    ORDER_ITEM {
        uuid id PK
        uuid order_id FK
        uuid product_id FK
        int quantity
    }
    PRODUCT {
        uuid id PK
        string name
        decimal price
        int stock
    }`,
  },
  {
    id: 'flow',
    title: '链路图',
    desc: '请求链路、业务流程、调用关系',
    icon: Workflow,
    keywords: ['flow', 'flowchart', 'liantu', '流程', '链路', '架构'],
    code: `flowchart LR
    A["客户端"] --> B["API 网关"]
    B --> C{"鉴权通过?"}
    C -- 否 --> D["返回 401"]
    C -- 是 --> E["业务服务"]
    E --> F[("MySQL")]
    E --> G[("Redis")]
    E -.-> H["消息队列"]
    H -.-> I["异步任务"]`,
  },
  {
    id: 'sequence',
    title: '时序图',
    desc: '多角色交互的先后顺序',
    icon: MessagesSquare,
    keywords: ['sequence', 'shixu', '时序', '交互'],
    code: `sequenceDiagram
    autonumber
    participant U as 用户
    participant W as 前端
    participant S as 服务端
    participant D as 数据库

    U->>W: 点击"保存"
    W->>S: PUT /api/notes/:id
    activate S
    S->>D: UPDATE notes SET ...
    D-->>S: OK
    S-->>W: 200 { updatedAt }
    deactivate S
    W-->>U: 顶部显示"已保存"`,
  },
  {
    id: 'mindmap',
    title: '思维导图',
    desc: '从一个主题向外发散',
    icon: Network,
    keywords: ['mindmap', 'siwei', '思维导图', '脑图'],
    code: `mindmap
  root(("笔记系统"))
    内容形态
      Markdown 文档
      多维表格
      图表
        链路图
        ER 图
    数据存储
      本地优先
      可导出
    使用场景
      技术笔记
      项目排期
      知识沉淀`,
  },
  {
    id: 'state',
    title: '状态图',
    desc: '状态与迁移条件',
    icon: Waypoints,
    keywords: ['state', 'zhuangtai', '状态', '状态机'],
    code: `stateDiagram-v2
    [*] --> 待支付
    待支付 --> 已支付 : 支付成功
    待支付 --> 已取消 : 超时 / 主动取消
    已支付 --> 已发货 : 出库
    已发货 --> 已完成 : 确认收货
    已支付 --> 退款中 : 申请退款
    退款中 --> 已退款 : 审核通过
    已完成 --> [*]
    已退款 --> [*]`,
  },
  {
    id: 'class',
    title: '类图',
    desc: '类、属性与继承关系',
    icon: Boxes,
    keywords: ['class', 'leitu', '类图', '继承'],
    code: `classDiagram
    class Block {
      <<abstract>>
      +String id
      +String type
      +render() void
      +serialize() String
    }
    class TextBlock {
      +String content
      +render() void
    }
    class TableBlock {
      +Field[] fields
      +Row[] rows
      +render() void
    }
    class DiagramBlock {
      +String code
      +String engine
      +render() void
    }
    Block <|-- TextBlock
    Block <|-- TableBlock
    Block <|-- DiagramBlock`,
  },
  {
    id: 'gantt',
    title: '甘特图',
    desc: '排期与任务依赖',
    icon: CalendarRange,
    keywords: ['gantt', 'gante', '甘特', '排期', '计划'],
    code: `gantt
    title 项目排期
    dateFormat  YYYY-MM-DD
    axisFormat  %m-%d

    section 设计
    需求梳理        :done,    d1, 2026-03-02, 3d
    原型设计        :active,  d2, after d1, 4d

    section 开发
    数据层          :         d3, after d2, 5d
    编辑器          :         d4, after d3, 6d
    多维表格        :         d5, after d3, 8d

    section 验收
    联调            :         d6, after d5, 3d
    上线            :milestone, d7, after d6, 0d`,
  },
  {
    id: 'pie',
    title: '饼图',
    desc: '占比构成',
    icon: PieChart,
    keywords: ['pie', 'bingtu', '饼图', '占比'],
    code: `pie showData
    title 笔记类型分布
    "技术文档" : 42
    "项目排期" : 18
    "读书笔记" : 25
    "随手记录" : 15`,
  },
]

export function templateById(id: string): DiagramTemplate | undefined {
  return diagramTemplates.find((t) => t.id === id)
}
