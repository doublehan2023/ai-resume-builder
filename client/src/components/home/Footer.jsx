import React from 'react'

const Footer = () => {
  return (
    <>
      <footer className="w-full bg-gradient-to-b from-green-200 to-[#FFFFFF] text-gray-800 mt-40">
            <div className="max-w-7xl mx-auto px-6 py-16 flex flex-col items-center">
                <div className="flex items-center space-x-3 mb-6">
                    <img alt="" className="h-11 w-auto"
                        src='/logo.svg' />
                </div>
                <p className="text-center max-w-xl text-sm font-normal leading-relaxed">
                    Empowering users worldwide with advanced AI resume builder. Get your resume ready in minutes!
                </p>
            </div>
            <div className="border-t border-slate-200">
                <div className="max-w-7xl mx-auto px-6 py-6 text-center text-sm font-normal">
                    <a href="https://prebuiltui.com">Han</a> ©2026. All rights reserved.
                </div>
            </div>
        </footer>
    </>
  )
}

export default Footer
