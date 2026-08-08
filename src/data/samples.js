/**
 * Built-in starter diagrams.
 *
 * These are plain document literals in the same shape as a `.arch.json` file,
 * so they double as a worked example of the format and survive the single-file
 * bundle without any fetching.
 *
 * It is the first diagram anyone sees, so it is also the argument for how to
 * draw one, and it follows the rules `data/prompt.js` hands to a model rather
 * than quietly breaking them:
 *
 * - one footprint, `[2, 2]`, and one height, `1`. Uniform height is what makes
 *   occlusion impossible rather than merely unlikely -- a block no taller than
 *   the one behind it can never hide it.
 * - `labelPlane` set on every block. The default lays a caption flat on the
 *   ground at 45 degrees, which is the single commonest way a diagram of this
 *   format comes out unreadable.
 * - captions are proper nouns of ten characters or fewer.
 * - one big title, on the VPC. Two compete; three are noise.
 * - five connections for thirteen blocks. Sharing a zone already says the
 *   blocks belong together, so the lines are spent on the request path and on
 *   nothing else: both web instances are identical, and drawing the load
 *   balancer's second arm would state that fact a second time.
 */

export const THREE_TIER = {
  version: 1,
  meta: { title: 'Three-tier web application' },
  groups: [
    // A zone's caption is pinned to one of its own back edges, and a nested
    // zone starts one cell along the same edge as the zone holding it. So the
    // subnets take the left wall and leave the right to the VPC, whose title
    // is nine times the size and would otherwise be written straight over
    // both of them.
    { id: 'edge-tier', kind: 'group', label: 'Edge', rect: [0, 0, 8, 16],
      color: '#2563eb', labelSize: 44 },
    { id: 'prod-vpc', kind: 'vpc', label: 'Production', rect: [10, 0, 29, 16],
      color: '#eab308', labelSize: 96 },
    // Pink rather than the olive it started as. A nested zone is painted over
    // its parent and captioned in a shade of itself, and olive sits about 30
    // degrees of hue from the VPC's yellow -- close enough that the subnet lost
    // its edge and its caption sank into the slab underneath it.
    { id: 'public-subnet', kind: 'subnet', label: 'Public', rect: [11, 1, 8, 14],
      color: '#e7157b', labelSize: 44, labelPlane: 'left', parent: 'prod-vpc' },
    { id: 'private-subnet', kind: 'subnet', label: 'Private', rect: [21, 1, 17, 14],
      color: '#a855f7', labelSize: 44, labelPlane: 'left', parent: 'prod-vpc' },
  ],
  nodes: [
    // Blocks are coloured by role rather than by service family, so the tiers
    // read as tiers: people, network, application, data.
    //
    // Three columns of three, on the same two rows across all of them, and
    // that is what the connections are laid out for rather than the other way
    // round: every one of them below is a straight run along a shared row.
    { id: 'visitors', type: 'user', label: 'Visitors', pos: [3, 3], height: 1,
      color: '#5a6b7b', labelSize: 40, labelPlane: 'right', group: 'edge-tier' },
    { id: 'cdn', type: 'cloudfront', label: 'CloudFront', pos: [3, 8], height: 1,
      color: '#1f8f8f', labelSize: 40, labelPlane: 'right', group: 'edge-tier' },
    { id: 'assets', type: 's3', label: 'Assets', pos: [3, 12], height: 1,
      color: '#b4530f', labelSize: 40, labelPlane: 'right', group: 'edge-tier' },

    { id: 'igw', type: 'igw', label: 'Gateway', pos: [14, 3], height: 1,
      color: '#1f8f8f', labelSize: 40, labelPlane: 'right', group: 'public-subnet' },
    { id: 'alb', type: 'elb', label: 'ALB', pos: [14, 8], height: 1,
      color: '#1f8f8f', labelSize: 40, labelPlane: 'right', group: 'public-subnet' },
    { id: 'nat', type: 'natgw', label: 'NAT', pos: [14, 12], height: 1,
      color: '#1f8f8f', labelSize: 40, labelPlane: 'right', group: 'public-subnet' },

    { id: 'web-2', type: 'ec2', label: 'Web 2', pos: [24, 3], height: 1,
      color: '#12a37a', labelSize: 40, labelPlane: 'right', group: 'private-subnet' },
    { id: 'web-1', type: 'ec2', label: 'Web 1', pos: [24, 8], height: 1,
      color: '#12a37a', labelSize: 40, labelPlane: 'right', group: 'private-subnet' },
    // The worker sits nearest the public subnet because it is the thing that
    // talks outward, which is also what keeps its line to the NAT clear of
    // everything else.
    { id: 'worker', type: 'ecs', label: 'Worker', pos: [24, 12], height: 1,
      color: '#12a37a', labelSize: 40, labelPlane: 'right', group: 'private-subnet' },
    { id: 'jobs', type: 'sqs', label: 'Queue', pos: [30, 12], height: 1,
      color: '#2c7de0', labelSize: 40, labelPlane: 'right', group: 'private-subnet' },

    { id: 'cache', type: 'elasticache', label: 'Redis', pos: [35, 3], height: 1,
      color: '#b4530f', labelSize: 40, labelPlane: 'right', group: 'private-subnet' },
    { id: 'db', type: 'rds', label: 'Postgres', pos: [35, 8], height: 1,
      color: '#b4530f', labelSize: 40, labelPlane: 'right', group: 'private-subnet' },
    { id: 'backups', type: 's3', label: 'Backups', pos: [35, 12], height: 1,
      color: '#b4530f', labelSize: 40, labelPlane: 'right', group: 'private-subnet' },
  ],
  // The request path in and the egress path out, and nothing else. Postgres,
  // Redis and the backups sit inside the private subnet, and that is the whole
  // statement about them -- an arrow from the web tier to its own database says
  // nothing the zone has not already said, and five of those turn a diagram
  // into a tangle.
  //
  // Every run here shares a row with its two ends, so each is a straight line
  // with nothing underneath it: in along y=8, out along y=12, and one elbow in
  // between. Captions go at 30px, because the 12px default is one you have to
  // hunt for.
  edges: [
    { id: 'e-https', from: 'cdn', to: 'alb', label: 'HTTPS', labelSize: 30, color: '#1f8f8f' },
    { id: 'e-web', from: 'alb', to: 'web-1', color: '#12a37a' },
    // The one turn in the diagram, pinned to the axis it should take rather
    // than left to the router to work out.
    { id: 'e-enqueue', from: 'web-1', to: 'jobs', route: 'x', color: '#2c7de0' },
    { id: 'e-work', from: 'jobs', to: 'worker', color: '#2c7de0' },
    // No caption: the dashed line and the note below say it, and the one that
    // was here landed on the Private zone's own name.
    { id: 'e-outbound', from: 'worker', to: 'nat', style: 'dashed', color: '#1f8f8f' },
  ],
  // Where the explanations go. A sentence in a block's caption collides with
  // the block next to it; a sentence here has open ground to itself.
  //
  // Both lie on the floor, which is the default and wants no `plane` written
  // out. A note is a paragraph laid on the ground of the scene rather than a
  // sticker on the glass: it skews with everything else and turns with the
  // camera, where anything pinned to the viewer reads as an overlay and slides
  // across the diagram as soon as the camera moves.
  //
  // 50px, which looks absurd in the file and is barely enough on screen: the
  // ground takes a cut for the projection and another for the 45 degree skew.
  // The lines are short because at that size they are already wide.
  texts: [
    {
      id: 'note-edge',
      text: 'Static assets never\nreach the VPC.',
      pos: [1, 19],
      size: 50,
      italic: true,
      color: '#64748b',
    },
    {
      id: 'note-private',
      text: 'No route in from\nthe internet.',
      pos: [24, 19],
      size: 50,
      italic: true,
      color: '#64748b',
    },
  ],
};

export const SAMPLES = [{ id: 'three-tier', label: 'Three-tier web app', doc: THREE_TIER }];
