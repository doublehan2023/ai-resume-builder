import ImageKit from '@imagekit/nodejs';

let imageKit;

const getImageKit = () => {
  if (!process.env.IMAGEKIT_PRIVATE_KEY) {
    throw new Error("IMAGEKIT_PRIVATE_KEY environment variable is not set");
  }

  if (!imageKit) {
    imageKit = new ImageKit({
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    });
  }

  return imageKit;
};

export default getImageKit;
