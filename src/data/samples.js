/**
 * Built-in starter diagrams.
 *
 * These are plain document literals in the same shape as a `.arch.json` file,
 * so they double as a worked example of the format and survive the single-file
 * bundle without any fetching.
 */

export const THREE_TIER = {
  version: 1,
  meta: { title: 'Three-tier web application' },
  groups: [
    { id: 'prod-vpc', kind: 'vpc', label: 'Production VPC', rect: [0, 0, 18, 12] },
    { id: 'public-subnet', kind: 'subnet', label: 'Public subnet', rect: [1, 1, 7, 10], parent: 'prod-vpc' },
    { id: 'private-subnet', kind: 'subnet', label: 'Private subnet', rect: [10, 1, 7, 10], parent: 'prod-vpc' },
  ],
  nodes: [
    { id: 'visitors', type: 'user', label: 'Visitors', pos: [-9, 4] },
    { id: 'cdn', type: 'cloudfront', label: 'CloudFront', pos: [-5, 4] },
    { id: 'assets', type: 's3', label: 'Static assets', pos: [-5, 8] },

    { id: 'igw', type: 'igw', label: 'Internet Gateway', pos: [2, 2], group: 'public-subnet' },
    { id: 'nat', type: 'natgw', label: 'NAT Gateway', pos: [5, 2], group: 'public-subnet' },
    { id: 'alb', type: 'elb', label: 'Application LB', pos: [2, 5], group: 'public-subnet' },

    { id: 'web-1', type: 'ec2', label: 'Web 1', pos: [11, 2], group: 'private-subnet' },
    { id: 'web-2', type: 'ec2', label: 'Web 2', pos: [14, 2], group: 'private-subnet' },
    { id: 'worker', type: 'ecs', label: 'Worker', pos: [14, 5], group: 'private-subnet' },
    { id: 'jobs', type: 'sqs', label: 'Job queue', pos: [11, 5], group: 'private-subnet' },
    { id: 'db', type: 'rds', label: 'PostgreSQL', pos: [11, 8], group: 'private-subnet' },
    { id: 'cache', type: 'elasticache', label: 'Redis', pos: [14, 8], group: 'private-subnet' },
  ],
  edges: [
    { id: 'e-visit', from: 'visitors', to: 'cdn' },
    { id: 'e-assets', from: 'cdn', to: 'assets', style: 'dashed' },
    { id: 'e-in', from: 'cdn', to: 'igw' },
    { id: 'e-alb', from: 'igw', to: 'alb' },
    { id: 'e-web1', from: 'alb', to: 'web-1' },
    { id: 'e-web2', from: 'alb', to: 'web-2' },
    { id: 'e-queue', from: 'web-1', to: 'jobs' },
    { id: 'e-worker', from: 'jobs', to: 'worker' },
    { id: 'e-db', from: 'web-1', to: 'db', label: '5432' },
    { id: 'e-cache', from: 'web-2', to: 'cache', label: '6379' },
    { id: 'e-nat', from: 'worker', to: 'nat', style: 'dashed' },
  ],
  texts: [
    {
      id: 'note-edge',
      text: 'Edge tier',
      pos: [-9, 1],
      size: 17,
      bold: true,
      color: '#334155',
    },
    {
      id: 'note-private',
      text: 'No inbound route from the internet.\nOutbound traffic leaves via the NAT gateway.',
      pos: [1, 13],
      size: 13,
      italic: true,
      color: '#64748b',
    },
  ],
};

export const SAMPLES = [{ id: 'three-tier', label: 'Three-tier web app', doc: THREE_TIER }];
