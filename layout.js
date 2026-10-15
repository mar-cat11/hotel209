// World-space layout and spatial audio tuning. Keep values in one place.
// Where the player stands when the chase starts or restarts: the left-lift event camera's spot, facing its target.
const standAt = c => [c.position[0], c.position[2], Math.atan2(-(c.target[0]-c.position[0]), -(c.target[2]-c.position[2]))*180/Math.PI, 0];
export const layout = {
  leftLiftCamera: {position:[7.1,1.5,20.9],target:[3.1,1.2,20.9],fov:48},
  chase: {
    corridors: [
      [6.2,7.6,8,31], [4.4,16,8,22],
      [6.2,7.6,23,9.6], [6.2,28.2,23,31], [21.3,9.6,23,28.2],
      [2,16.1,4.5,18.3], [2,19.8,4.5,22],
    ],
    spawn: [3.1,20.9],
    clear: {minX:2.2,maxX:4.1,z:20.9,halfDepth:.65},
    grid: {step:.25,width:93,height:157,playerRadius:.22},
  },
  merry: {room:207,roomMargin:.3,doorReach:1.5,maxVolume:.75,falloff:1.6},
};
layout.chase.startPose = standAt(layout.leftLiftCamera);
