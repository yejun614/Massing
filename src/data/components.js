/**
 * Component type registry.
 *
 * A type supplies the defaults used when a node is created or when a loaded
 * document omits a field. Unknown types degrade to `generic` rather than
 * failing the load, so a document written by hand (or by an LLM) with a typo
 * still opens.
 */

// Colours are lower-case because the loader normalises them that way; keeping
// the defaults in the same form is what makes save -> load -> save stable.
export const CATEGORIES = [
  { id: 'compute', label: 'Compute', color: '#ed7100' },
  { id: 'storage', label: 'Storage', color: '#7aa116' },
  { id: 'database', label: 'Database', color: '#c925d1' },
  { id: 'network', label: 'Network', color: '#8c4fff' },
  { id: 'integration', label: 'Integration', color: '#e7157b' },
  { id: 'security', label: 'Security', color: '#dd344c' },
  { id: 'language', label: 'Languages', color: '#2f6fb0' },
  { id: 'framework', label: 'Frameworks', color: '#12a37a' },
  { id: 'datastore', label: 'Data stores', color: '#b4530f' },
  { id: 'devops', label: 'DevOps', color: '#2c7de0' },
  { id: 'ai', label: 'AI & data', color: '#d4471a' },
  { id: 'observability', label: 'Observability', color: '#e0713a' },
  { id: 'realtime', label: 'Realtime', color: '#1f8f8f' },
  { id: 'audio', label: 'Audio', color: '#6d4bd6' },
  { id: 'client', label: 'Client', color: '#2b6cb0' },
  { id: 'generic', label: 'Generic', color: '#5a6b7b' },
];

const CATEGORY_COLOR = new Map(CATEGORIES.map((c) => [c.id, c.color]));

/** `[type, label, category, icon, height]` -- footprint is 2x2 for every type. */
const TABLE = [
  ['ec2', 'EC2 Instance', 'compute', 'ec2', 2],
  ['lambda', 'Lambda', 'compute', 'lambda', 1],
  ['ecs', 'ECS Service', 'compute', 'ecs', 2],
  ['eks', 'EKS Cluster', 'compute', 'eks', 3],
  ['fargate', 'Fargate Task', 'compute', 'fargate', 2],
  ['batch', 'Batch Job', 'compute', 'batch', 2],

  ['s3', 'S3 Bucket', 'storage', 's3', 2],
  ['ebs', 'EBS Volume', 'storage', 'ebs', 1],
  ['efs', 'EFS', 'storage', 'efs', 2],
  ['glacier', 'Glacier', 'storage', 'glacier', 1],

  ['rds', 'RDS', 'database', 'rds', 3],
  ['aurora', 'Aurora', 'database', 'aurora', 3],
  ['dynamodb', 'DynamoDB', 'database', 'dynamodb', 2],
  ['elasticache', 'ElastiCache', 'database', 'elasticache', 2],
  ['redshift', 'Redshift', 'database', 'redshift', 3],

  ['elb', 'Load Balancer', 'network', 'elb', 1],
  ['cloudfront', 'CloudFront', 'network', 'cloudfront', 2],
  ['route53', 'Route 53', 'network', 'route53', 1],
  ['apigateway', 'API Gateway', 'network', 'apigateway', 1],
  ['natgw', 'NAT Gateway', 'network', 'natgw', 1],
  ['igw', 'Internet Gateway', 'network', 'igw', 1],

  ['sqs', 'SQS Queue', 'integration', 'sqs', 1],
  ['sns', 'SNS Topic', 'integration', 'sns', 1],
  ['eventbridge', 'EventBridge', 'integration', 'eventbridge', 2],
  ['kinesis', 'Kinesis Stream', 'integration', 'kinesis', 2],

  ['iam', 'IAM Role', 'security', 'iam', 1],
  ['waf', 'WAF', 'security', 'waf', 1],
  ['cognito', 'Cognito', 'security', 'cognito', 2],
  ['kms', 'KMS Key', 'security', 'kms', 1],

  ['java', 'Java', 'language', 'java', 2],
  ['kotlin', 'Kotlin', 'language', 'kotlin', 2],
  ['python', 'Python', 'language', 'python', 2],
  ['javascript', 'JavaScript', 'language', 'js', 2],
  ['typescript', 'TypeScript', 'language', 'ts', 2],
  ['rust', 'Rust', 'language', 'rust', 2],

  ['springboot', 'Spring Boot', 'framework', 'spring', 3],
  ['react', 'React', 'framework', 'react', 2],
  ['vue', 'Vue', 'framework', 'vue', 2],
  ['svelte', 'Svelte', 'framework', 'svelte', 2],
  ['vite', 'Vite', 'framework', 'vite', 1],
  ['tauri', 'Tauri', 'framework', 'tauri', 2],
  ['nodejs', 'Node.js', 'framework', 'js', 2],

  ['mysql', 'MySQL', 'datastore', 'mysql', 3],
  ['postgresql', 'PostgreSQL', 'datastore', 'postgres', 3],
  ['mongodb', 'MongoDB', 'datastore', 'cylinder', 3],
  ['redis', 'Redis', 'datastore', 'redis', 2],
  ['rabbitmq', 'RabbitMQ', 'datastore', 'rabbitmq', 2],
  ['erd', 'ER diagram', 'datastore', 'erd', 1],

  ['docker', 'Docker', 'devops', 'docker', 2],
  ['kubernetes', 'Kubernetes', 'devops', 'kubernetes', 3],
  ['jenkins', 'Jenkins', 'devops', 'jenkins', 2],
  ['git', 'Git repository', 'devops', 'gitBranch', 1],
  ['npm', 'npm', 'devops', 'npm', 1],
  ['pip', 'pip', 'devops', 'pip', 1],
  ['uv', 'uv', 'devops', 'uv', 1],

  ['pytorch', 'PyTorch', 'ai', 'pytorch', 2],
  ['tensorflow', 'TensorFlow', 'ai', 'tensorflow', 2],
  ['numpy', 'NumPy', 'ai', 'numpy', 2],
  ['pandas', 'pandas', 'ai', 'pandas', 2],
  ['llm', 'Model', 'ai', 'brain', 3],
  ['gpu', 'GPU node', 'ai', 'gpu', 2],

  ['prometheus', 'Prometheus', 'observability', 'prometheus', 2],
  ['grafana', 'Grafana', 'observability', 'grafana', 2],
  ['loki', 'Loki', 'observability', 'logs', 2],
  ['alloy', 'Grafana Alloy', 'observability', 'collector', 2],
  ['node-exporter', 'node-exporter', 'observability', 'gauge', 1],
  ['healthcheck', 'Health check', 'observability', 'heartbeat', 1],

  ['webrtc', 'WebRTC', 'realtime', 'peers', 2],
  ['websocket', 'WebSocket', 'realtime', 'duplex', 1],
  ['zeromq', 'ZeroMQ', 'realtime', 'zeromq', 2],
  ['stun', 'STUN server', 'realtime', 'beacon', 2],
  ['turn', 'TURN relay', 'realtime', 'relay', 2],
  ['p2p', 'Peer-to-peer', 'realtime', 'mesh', 1],
  ['rtp', 'RTP stream', 'realtime', 'packets', 1],
  ['nat', 'NAT / firewall', 'realtime', 'boundary', 1],
  ['nginx', 'nginx', 'realtime', 'nginx', 2],
  ['reverse-proxy', 'Reverse proxy', 'realtime', 'fanout', 2],

  ['microphone', 'Microphone', 'audio', 'microphone', 1],
  ['headphone', 'Headphones', 'audio', 'headphone', 1],
  ['speaker', 'Speaker', 'audio', 'speaker', 1],
  ['webcam', 'Webcam', 'audio', 'webcam', 1],
  ['asio', 'ASIO driver', 'audio', 'lowlatency', 1],
  ['wasapi', 'WASAPI', 'audio', 'winaudio', 1],
  ['audio-interface', 'Audio interface', 'audio', 'audiointerface', 1],
  ['waveform', 'Waveform', 'audio', 'waveform', 1],
  ['opus', 'Opus codec', 'audio', 'codec', 1],
  ['h264', 'H.264 codec', 'audio', 'videocodec', 1],
  ['ringbuffer', 'Ring buffer', 'audio', 'ringbuffer', 1],
  ['mixer', 'Mixer', 'audio', 'mixer', 2],
  ['midi-keyboard', 'MIDI keyboard', 'audio', 'pianokeys', 1],
  ['sampler', 'Sampler', 'audio', 'pads', 2],
  ['metronome', 'Metronome', 'audio', 'metronome', 2],
  ['music-note', 'Track', 'audio', 'musicnote', 1],
  ['recording', 'Recording', 'audio', 'record', 1],
  ['ffmpeg', 'FFmpeg', 'audio', 'filmstrip', 2],
  ['demucs', 'Demucs', 'audio', 'stems', 2],

  ['gradle', 'Gradle', 'devops', 'gradle', 1],
  ['cargo', 'Cargo', 'devops', 'crate', 1],
  ['gitlab', 'GitLab', 'devops', 'gitlab', 2],
  ['dockerhub', 'Docker Hub', 'devops', 'registry', 2],
  ['installer', 'Installer', 'devops', 'installer', 1],
  ['certbot', 'Certbot / TLS', 'devops', 'certificate', 1],
  ['webhook', 'Webhook', 'devops', 'webhook', 1],
  ['worker', 'Worker', 'devops', 'worker', 2],
  ['terminal', 'Terminal / TUI', 'devops', 'terminal', 1],
  ['swagger', 'Swagger / OpenAPI', 'devops', 'swagger', 1],
  ['mattermost', 'Mattermost', 'devops', 'mattermost', 2],
  ['jira', 'Jira', 'devops', 'jira', 2],

  ['oauth2', 'OAuth 2', 'security', 'oauth', 1],
  ['jwt', 'JWT', 'security', 'token', 1],
  ['google', 'Google', 'security', 'google', 2],
  ['kakao', 'Kakao', 'security', 'kakao', 2],

  ['volume', 'Docker volume', 'datastore', 'volume', 2],
  ['filesystem', 'File system', 'datastore', 'filetree', 2],
  ['flyway', 'Flyway', 'datastore', 'migration', 1],

  ['gemini', 'Google Gemini', 'ai', 'sparkle4', 2],

  ['tailwind', 'Tailwind CSS', 'framework', 'tailwind', 1],

  ['windows', 'Windows', 'client', 'windows', 1],
  ['desktop-app', 'Desktop app', 'client', 'desktopapp', 2],
  ['webview2', 'WebView2', 'client', 'webview', 2],

  ['server', 'Server', 'generic', 'server', 2],
  ['database', 'Database', 'generic', 'database', 3],
  ['queue', 'Queue', 'generic', 'queue', 1],
  ['storage', 'Storage', 'generic', 'storage', 2],
  ['container', 'Container', 'generic', 'container', 2],
  ['user', 'User', 'generic', 'user', 1],
  ['internet', 'Internet', 'generic', 'internet', 1],
  ['generic', 'Block', 'generic', 'box', 1],
];

export const COMPONENTS = TABLE.map(([type, label, category, icon, height]) => ({
  type,
  label,
  category,
  icon,
  height,
  size: [2, 2],
  color: CATEGORY_COLOR.get(category),
}));

const BY_TYPE = new Map(COMPONENTS.map((c) => [c.type, c]));

export const FALLBACK_TYPE = 'generic';

export function isKnownType(type) {
  return BY_TYPE.has(type);
}

/** Definition for `type`, falling back to the generic block. */
export function componentFor(type) {
  return BY_TYPE.get(type) || BY_TYPE.get(FALLBACK_TYPE);
}

export function componentsByCategory() {
  return CATEGORIES.map((cat) => ({
    ...cat,
    items: COMPONENTS.filter((c) => c.category === cat.id),
  }));
}

// ---------------------------------------------------------------------------
// Group kinds -- the flat translucent slabs that blocks sit on.
// ---------------------------------------------------------------------------

export const GROUP_KINDS = [
  // Boundaries for a system that runs on machines rather than in a cloud
  // account: one host, its container network, and each participant's PC.
  { kind: 'host', label: 'Host', color: '#2b6cb0', dash: false },
  { kind: 'docker-network', label: 'Docker network', color: '#0ea5a5', dash: true },
  { kind: 'desktop-machine', label: 'Desktop machine', color: '#6d4bd6', dash: false },
  { kind: 'lan', label: 'LAN / behind NAT', color: '#b45309', dash: true },
  { kind: 'vpc', label: 'VPC', color: '#8c4fff', dash: false },
  { kind: 'subnet', label: 'Subnet', color: '#7aa116', dash: true },
  { kind: 'az', label: 'Availability Zone', color: '#2a7fd4', dash: true },
  { kind: 'account', label: 'Account', color: '#dd344c', dash: false },
  { kind: 'group', label: 'Group', color: '#5a6b7b', dash: true },
];

const BY_KIND = new Map(GROUP_KINDS.map((g) => [g.kind, g]));

export function groupKindFor(kind) {
  return BY_KIND.get(kind) || BY_KIND.get('group');
}
